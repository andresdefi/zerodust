#!/bin/bash

# =============================================================================
# ZeroDust V2 E2E Test Script
# =============================================================================
# Tests the full EIP-7702 sweep flow for V2 (same-chain and cross-chain)
#
# Prerequisites:
# - Testnet must support EIP-7702
# - Fund RELAYER_ADDRESS with gas for transactions (script creates test users)
#
# Usage:
#   export RELAYER_PRIVATE_KEY=0x...
#   export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
#   export SWEEP_V2_CONTRACT=0x...
#   export MOCK_ADAPTER=0x...  # Optional, only for cross-chain tests
#   export USER_PRIVATE_KEY=0x...  # Optional, reuse test address to save funds
#   ./script/e2e-test-v2.sh [same-chain|cross-chain|both]
#
# If USER_PRIVATE_KEY is set, the script reuses that address (only funds if needed).
# If not set, the script creates a new test user and prints the key for reuse.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "=============================================="
echo "      ZeroDust V2 E2E Test with EIP-7702      "
echo "=============================================="

# Check required environment variables
if [ -z "$RELAYER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: RELAYER_PRIVATE_KEY not set${NC}"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
    echo -e "${YELLOW}Using default RPC: $RPC_URL${NC}"
fi

# Contract addresses (MUST be set via environment for each chain)
if [ -z "$SWEEP_V2_CONTRACT" ]; then
    echo -e "${RED}ERROR: SWEEP_V2_CONTRACT not set${NC}"
    echo "Set the V2 contract address for this chain"
    exit 1
fi

MOCK_ADAPTER=${MOCK_ADAPTER:-""}  # Optional, only needed for cross-chain tests

# Test mode (same-chain, cross-chain, or both)
TEST_MODE=${1:-"both"}

# Funding amount for test users (in wei)
TEST_FUNDING=${TEST_FUNDING:-"100000000000000"}  # 0.0001 ETH default (minimal for tests)

# Derive relayer address
RELAYER_ADDRESS=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)

# Destination defaults to relayer
DESTINATION=${DESTINATION:-$RELAYER_ADDRESS}

# Get chain ID
CHAIN_ID=$(cast chain-id --rpc-url $RPC_URL)

echo ""
echo "Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  V2 Contract: $SWEEP_V2_CONTRACT"
echo "  MockAdapter: $MOCK_ADAPTER"
echo "  Relayer Address: $RELAYER_ADDRESS"
echo "  Destination: $DESTINATION"
echo "  Chain ID: $CHAIN_ID"
echo "  Test Mode: $TEST_MODE"
echo "  Test Funding: $TEST_FUNDING wei"

# Helper function to setup test user (reuse if USER_PRIVATE_KEY is set, otherwise create new)
setup_test_user() {
    echo ""

    # If USER_PRIVATE_KEY is provided, reuse that address
    if [ -n "$USER_PRIVATE_KEY" ]; then
        USER_ADDRESS=$(cast wallet address --private-key $USER_PRIVATE_KEY)
        echo -e "${YELLOW}Reusing test user: $USER_ADDRESS${NC}"

        # Check current balance
        CURRENT_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
        echo "  Current Balance: $CURRENT_BALANCE wei"

        # Fund only if balance is below threshold
        if [ "$CURRENT_BALANCE" -lt "$TEST_FUNDING" ]; then
            echo "  Balance low, funding with $TEST_FUNDING wei..."
            FUND_TX=$(cast send $USER_ADDRESS --value $TEST_FUNDING --private-key $RELAYER_PRIVATE_KEY --rpc-url $RPC_URL --json 2>&1)
            FUND_STATUS=$(echo $FUND_TX | jq -r '.status')

            if [ "$FUND_STATUS" != "0x1" ]; then
                echo -e "${RED}Failed to fund test user${NC}"
                echo "$FUND_TX"
                exit 1
            fi
            sleep 5
            CURRENT_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
            echo "  New Balance: $CURRENT_BALANCE wei"
        fi
    else
        # Generate new random private key
        echo -e "${YELLOW}Creating new test user...${NC}"
        USER_PRIVATE_KEY="0x$(openssl rand -hex 32)"
        USER_ADDRESS=$(cast wallet address --private-key $USER_PRIVATE_KEY)
        echo "  Generated Address: $USER_ADDRESS"
        echo "  (Set USER_PRIVATE_KEY=$USER_PRIVATE_KEY to reuse this address)"

        # Fund the test user from relayer
        echo "  Funding with $TEST_FUNDING wei..."
        FUND_TX=$(cast send $USER_ADDRESS --value $TEST_FUNDING --private-key $RELAYER_PRIVATE_KEY --rpc-url $RPC_URL --json 2>&1)
        FUND_STATUS=$(echo $FUND_TX | jq -r '.status')

        if [ "$FUND_STATUS" != "0x1" ]; then
            echo -e "${RED}Failed to fund test user${NC}"
            echo "$FUND_TX"
            exit 1
        fi

        # Wait for confirmation
        sleep 5
    fi

    # Verify balance
    FUNDED_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
    echo "  Test Balance: $FUNDED_BALANCE wei"

    if [ "$FUNDED_BALANCE" == "0" ]; then
        echo -e "${RED}ERROR: Test user has zero balance${NC}"
        exit 1
    fi

    echo -e "${GREEN}  Test user ready!${NC}"
}

# Verified type hashes from deployed contract
SAME_CHAIN_SWEEP_TYPEHASH="0x45e0db5d879a9ee92ab7038e10ca7729fb43c37be191ce9c51ec2a5af00510e6"
CROSS_CHAIN_SWEEP_TYPEHASH="0x85674f956c6c9e743d9814c98b70584b3db3eb96a312632cf996662990b6b40f"

# =============================================================================
# SAME-CHAIN SWEEP TEST
# =============================================================================
test_same_chain_sweep() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}    SAME-CHAIN SWEEP TEST (V2)         ${NC}"
    echo -e "${CYAN}========================================${NC}"

    # Setup test user (reuses if USER_PRIVATE_KEY is set)
    setup_test_user

    # Get initial balances
    USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
    RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)

    echo ""
    echo "Initial Balances:"
    echo "  User: $USER_BALANCE wei ($(cast from-wei $USER_BALANCE) ETH)"
    echo "  Relayer: $RELAYER_BALANCE wei"

    if [ "$USER_BALANCE" == "0" ]; then
        echo -e "${RED}ERROR: User has zero balance. Fund the address first.${NC}"
        return 1
    fi

    # Fresh users start with nonce 0
    # Note: Under EIP-7702, nonce is stored in user's EOA storage (not queryable externally)
    NONCE=0
    echo "  User's sweep nonce: $NONCE"

    # Authorization parameters
    MAX_RELAYER_FEE=$USER_BALANCE  # Allow up to full balance as fee
    DEADLINE=$(($(date +%s) + 3600))  # 1 hour from now

    echo ""
    echo "Authorization Parameters:"
    echo "  Max Relayer Fee: $MAX_RELAYER_FEE wei"
    echo "  Deadline: $DEADLINE"
    echo "  Nonce: $NONCE"

    # Get domain separator from contract
    DOMAIN_SEPARATOR=$(cast call $SWEEP_V2_CONTRACT "DOMAIN_SEPARATOR()(bytes32)" --rpc-url $RPC_URL)
    echo "  Domain Separator: $DOMAIN_SEPARATOR"

    # Compute struct hash for SameChainSweep
    # struct SameChainSweep { address user; address destination; address relayer; uint256 maxRelayerFee; uint256 deadline; uint256 nonce; }
    echo ""
    echo "Computing EIP-712 signature..."

    STRUCT_HASH=$(cast keccak256 $(cast abi-encode \
        "x(bytes32,address,address,address,uint256,uint256,uint256)" \
        $SAME_CHAIN_SWEEP_TYPEHASH \
        $USER_ADDRESS \
        $DESTINATION \
        $RELAYER_ADDRESS \
        $MAX_RELAYER_FEE \
        $DEADLINE \
        $NONCE))
    echo "  Struct Hash: $STRUCT_HASH"

    # Compute EIP-712 digest: keccak256("\x19\x01" || domainSeparator || structHash)
    DIGEST=$(cast keccak256 $(cast concat-hex "0x1901" $DOMAIN_SEPARATOR $STRUCT_HASH))
    echo "  EIP-712 Digest: $DIGEST"

    # Sign the digest with user's key
    SIGNATURE=$(cast wallet sign --no-hash --private-key $USER_PRIVATE_KEY $DIGEST)
    echo "  Signature: ${SIGNATURE:0:42}..."

    # Sign EIP-7702 delegation to V2 contract
    echo ""
    echo "Signing EIP-7702 delegation..."
    SIGNED_AUTH=$(cast wallet sign-auth $SWEEP_V2_CONTRACT --private-key $USER_PRIVATE_KEY --rpc-url $RPC_URL)
    echo "  Signed Auth: ${SIGNED_AUTH:0:50}..."

    # Build calldata for executeSameChainSweep
    CALLDATA=$(cast calldata \
        "executeSameChainSweep((address,address,address,uint256,uint256,uint256),bytes)" \
        "($USER_ADDRESS,$DESTINATION,$RELAYER_ADDRESS,$MAX_RELAYER_FEE,$DEADLINE,$NONCE)" \
        "$SIGNATURE")
    echo "  Calldata: ${CALLDATA:0:66}..."

    # Execute the sweep transaction
    echo ""
    echo -e "${YELLOW}Executing same-chain sweep transaction...${NC}"

    RESULT=$(cast send $USER_ADDRESS \
        $CALLDATA \
        --private-key $RELAYER_PRIVATE_KEY \
        --rpc-url $RPC_URL \
        --auth $SIGNED_AUTH \
        --json 2>&1)

    TX_HASH=$(echo $RESULT | jq -r '.transactionHash')
    echo "  Transaction Hash: $TX_HASH"

    # Get receipt
    sleep 2
    RECEIPT=$(cast receipt $TX_HASH --rpc-url $RPC_URL --json 2>&1)
    STATUS=$(echo $RECEIPT | jq -r '.status')
    GAS_USED=$(echo $RECEIPT | jq -r '.gasUsed')

    echo "  Status: $STATUS"
    echo "  Gas Used: $GAS_USED"

    if [ "$STATUS" != "0x1" ]; then
        echo -e "${RED}Transaction FAILED!${NC}"
        echo "Receipt: $RECEIPT"
        return 1
    fi

    # Check final balances
    echo ""
    echo "Final Balances:"
    FINAL_USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
    FINAL_RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)
    echo "  User: $FINAL_USER_BALANCE wei"
    echo "  Relayer: $FINAL_RELAYER_BALANCE wei"

    if [ "$FINAL_USER_BALANCE" == "0" ]; then
        echo ""
        echo -e "${GREEN}SUCCESS: User balance is exactly ZERO!${NC}"
        return 0
    else
        echo ""
        echo -e "${RED}FAILED: User balance is NOT zero: $FINAL_USER_BALANCE wei${NC}"
        return 1
    fi
}

# =============================================================================
# CROSS-CHAIN SWEEP TEST (with MockAdapter)
# =============================================================================
test_cross_chain_sweep() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   CROSS-CHAIN SWEEP TEST (V2 + Mock)   ${NC}"
    echo -e "${CYAN}========================================${NC}"

    # Setup test user (reuses if USER_PRIVATE_KEY is set)
    setup_test_user

    # Get initial state
    USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
    RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)
    ADAPTER_BRIDGED=$(cast call $MOCK_ADAPTER "totalBridged()(uint256)" --rpc-url $RPC_URL)

    echo ""
    echo "Initial State:"
    echo "  User Balance: $USER_BALANCE wei ($(cast from-wei $USER_BALANCE) ETH)"
    echo "  Relayer Balance: $RELAYER_BALANCE wei"
    echo "  MockAdapter Total Bridged: $ADAPTER_BRIDGED wei"

    if [ "$USER_BALANCE" == "0" ]; then
        echo -e "${RED}ERROR: User has zero balance. Fund the address first.${NC}"
        return 1
    fi

    # Fresh users start with nonce 0
    # Note: Under EIP-7702, nonce is stored in user's EOA storage (not queryable externally)
    NONCE=0
    echo "  User's sweep nonce: $NONCE"

    # Authorization parameters
    MAX_RELAYER_FEE=$((USER_BALANCE / 2))  # Half for relayer
    MIN_RECEIVE=1  # Minimum 1 wei
    DEST_CHAIN_ID=84532  # Base Sepolia (mocked)
    DEADLINE=$(($(date +%s) + 3600))
    REFUND_RECIPIENT=$RELAYER_ADDRESS  # Must equal relayer per V2 rules

    echo ""
    echo "Authorization Parameters:"
    echo "  Destination Chain: $DEST_CHAIN_ID (Base Sepolia - mocked)"
    echo "  Destination: $DESTINATION"
    echo "  Relayer: $RELAYER_ADDRESS"
    echo "  Adapter: $MOCK_ADAPTER"
    echo "  Refund Recipient: $REFUND_RECIPIENT"
    echo "  Max Relayer Fee: $MAX_RELAYER_FEE wei"
    echo "  Min Receive: $MIN_RECEIVE wei"
    echo "  Deadline: $DEADLINE"
    echo "  Nonce: $NONCE"

    # Get domain separator
    DOMAIN_SEPARATOR=$(cast call $SWEEP_V2_CONTRACT "DOMAIN_SEPARATOR()(bytes32)" --rpc-url $RPC_URL)
    echo "  Domain Separator: $DOMAIN_SEPARATOR"

    # Compute struct hash for CrossChainSweep
    # struct CrossChainSweep { address user; uint256 destinationChainId; address destination; address relayer;
    #                         address adapter; address refundRecipient; uint256 maxRelayerFee; uint256 minReceive;
    #                         uint256 deadline; uint256 nonce; }
    echo ""
    echo "Computing EIP-712 signature..."

    STRUCT_HASH=$(cast keccak256 $(cast abi-encode \
        "x(bytes32,address,uint256,address,address,address,address,uint256,uint256,uint256,uint256)" \
        $CROSS_CHAIN_SWEEP_TYPEHASH \
        $USER_ADDRESS \
        $DEST_CHAIN_ID \
        $DESTINATION \
        $RELAYER_ADDRESS \
        $MOCK_ADAPTER \
        $REFUND_RECIPIENT \
        $MAX_RELAYER_FEE \
        $MIN_RECEIVE \
        $DEADLINE \
        $NONCE))
    echo "  Struct Hash: $STRUCT_HASH"

    # Compute EIP-712 digest
    DIGEST=$(cast keccak256 $(cast concat-hex "0x1901" $DOMAIN_SEPARATOR $STRUCT_HASH))
    echo "  EIP-712 Digest: $DIGEST"

    # Sign the digest
    SIGNATURE=$(cast wallet sign --no-hash --private-key $USER_PRIVATE_KEY $DIGEST)
    echo "  Signature: ${SIGNATURE:0:42}..."

    # Sign EIP-7702 delegation
    echo ""
    echo "Signing EIP-7702 delegation..."
    SIGNED_AUTH=$(cast wallet sign-auth $SWEEP_V2_CONTRACT --private-key $USER_PRIVATE_KEY --rpc-url $RPC_URL)
    echo "  Signed Auth: ${SIGNED_AUTH:0:50}..."

    # Empty adapter data for mock
    ADAPTER_DATA="0x"

    # Build calldata for executeCrossChainSweep
    # Function signature: executeCrossChainSweep(sweep, signature, adapterData)
    CALLDATA=$(cast calldata \
        "executeCrossChainSweep((address,uint256,address,address,address,address,uint256,uint256,uint256,uint256),bytes,bytes)" \
        "($USER_ADDRESS,$DEST_CHAIN_ID,$DESTINATION,$RELAYER_ADDRESS,$MOCK_ADAPTER,$REFUND_RECIPIENT,$MAX_RELAYER_FEE,$MIN_RECEIVE,$DEADLINE,$NONCE)" \
        "$SIGNATURE" \
        "$ADAPTER_DATA")
    echo "  Calldata: ${CALLDATA:0:66}..."

    # Execute the sweep
    echo ""
    echo -e "${YELLOW}Executing cross-chain sweep transaction...${NC}"

    RESULT=$(cast send $USER_ADDRESS \
        $CALLDATA \
        --private-key $RELAYER_PRIVATE_KEY \
        --rpc-url $RPC_URL \
        --auth $SIGNED_AUTH \
        --json 2>&1)

    # Check if cast send failed (returned error text instead of JSON)
    if ! echo "$RESULT" | jq -e '.transactionHash' > /dev/null 2>&1; then
        echo -e "${RED}Transaction submission FAILED!${NC}"
        echo "Error: $RESULT"
        return 1
    fi

    TX_HASH=$(echo $RESULT | jq -r '.transactionHash')
    echo "  Transaction Hash: $TX_HASH"

    # Get receipt
    sleep 3
    RECEIPT=$(cast receipt $TX_HASH --rpc-url $RPC_URL --json 2>&1)

    if ! echo "$RECEIPT" | jq -e '.status' > /dev/null 2>&1; then
        echo -e "${RED}Failed to get receipt!${NC}"
        echo "Error: $RECEIPT"
        return 1
    fi

    STATUS=$(echo $RECEIPT | jq -r '.status')
    GAS_USED=$(echo $RECEIPT | jq -r '.gasUsed')

    echo "  Status: $STATUS"
    echo "  Gas Used: $GAS_USED"

    if [ "$STATUS" != "0x1" ]; then
        echo -e "${RED}Transaction FAILED!${NC}"
        echo "Receipt: $RECEIPT"
        return 1
    fi

    # Check final state
    echo ""
    echo "Final State:"
    FINAL_USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
    FINAL_RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)
    FINAL_ADAPTER_BRIDGED=$(cast call $MOCK_ADAPTER "totalBridged()(uint256)" --rpc-url $RPC_URL)

    echo "  User Balance: $FINAL_USER_BALANCE wei"
    echo "  Relayer Balance: $FINAL_RELAYER_BALANCE wei"
    echo "  MockAdapter Total Bridged: $FINAL_ADAPTER_BRIDGED wei"

    # Calculate bridged amount (extract numeric value, cast may return "123 [1.23e2]" format)
    ADAPTER_BRIDGED_NUM=$(echo "$ADAPTER_BRIDGED" | awk '{print $1}')
    FINAL_ADAPTER_BRIDGED_NUM=$(echo "$FINAL_ADAPTER_BRIDGED" | awk '{print $1}')
    BRIDGED_AMOUNT=$((FINAL_ADAPTER_BRIDGED_NUM - ADAPTER_BRIDGED_NUM))
    echo "  Amount Bridged This Tx: $BRIDGED_AMOUNT wei"

    if [ "$FINAL_USER_BALANCE" == "0" ]; then
        echo ""
        echo -e "${GREEN}SUCCESS: User balance is exactly ZERO!${NC}"
        echo ""
        echo "Cross-chain sweep summary:"
        echo "  - User's entire balance swept"
        echo "  - Relayer received fee compensation"
        echo "  - MockAdapter received $BRIDGED_AMOUNT wei (simulated bridge)"
        return 0
    else
        echo ""
        echo -e "${RED}FAILED: User balance is NOT zero: $FINAL_USER_BALANCE wei${NC}"
        return 1
    fi
}

# =============================================================================
# MAIN
# =============================================================================
echo ""

case $TEST_MODE in
    "same-chain")
        test_same_chain_sweep
        ;;
    "cross-chain")
        test_cross_chain_sweep
        ;;
    "both")
        echo "Running both tests sequentially..."
        echo "(Each test creates its own fresh test user)"

        # Same-chain test (creates fresh user)
        if test_same_chain_sweep; then
            echo ""
            echo -e "${YELLOW}Same-chain test PASSED. Running cross-chain test...${NC}"
            sleep 1

            # Cross-chain test (creates fresh user)
            if test_cross_chain_sweep; then
                echo ""
                echo -e "${GREEN}========================================${NC}"
                echo -e "${GREEN}    ALL V2 E2E TESTS PASSED!           ${NC}"
                echo -e "${GREEN}========================================${NC}"
            else
                echo ""
                echo -e "${RED}Cross-chain test FAILED${NC}"
                exit 1
            fi
        else
            echo ""
            echo -e "${RED}Same-chain test FAILED${NC}"
            exit 1
        fi
        ;;
    *)
        echo -e "${RED}Invalid test mode: $TEST_MODE${NC}"
        echo "Usage: $0 [same-chain|cross-chain|both]"
        exit 1
        ;;
esac
