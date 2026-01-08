#!/bin/bash

# =============================================================================
# ZeroDust V2 REAL Cross-Chain E2E Test Script
# =============================================================================
# Tests actual cross-chain sweep using OPStackAdapter (Sepolia → Base Sepolia)
#
# This is a REAL cross-chain test - funds actually bridge to Base Sepolia!
# Bridge time: ~2-10 minutes for L1→L2
#
# Prerequisites:
# - RELAYER_PRIVATE_KEY with Sepolia ETH
# - Deployed contracts on Sepolia:
#   - ZeroDustSweepV2
#   - OPStackAdapter (configured for Base Sepolia)
#
# Usage:
#   export RELAYER_PRIVATE_KEY=0x...
#   export SWEEP_V2_CONTRACT=0xc2f18d998AB364BeaCcAF95e50B8a959Ce6A5F78
#   export OP_STACK_ADAPTER=0x827463988bdadA6dFaA2dF75e8516F723117dC04
#   ./script/e2e-test-real-crosschain.sh
#
# After the test, check Base Sepolia for the bridged funds:
#   cast balance <DESTINATION_ADDRESS> --rpc-url https://sepolia.base.org
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "=============================================="
echo "   ZeroDust V2 REAL Cross-Chain E2E Test     "
echo "   Sepolia (L1) → Base Sepolia (L2)          "
echo "=============================================="

# Check required environment
if [ -z "$RELAYER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: RELAYER_PRIVATE_KEY not set${NC}"
    exit 1
fi

# Default RPC URLs
SEPOLIA_RPC=${SEPOLIA_RPC:-"https://ethereum-sepolia-rpc.publicnode.com"}
BASE_SEPOLIA_RPC=${BASE_SEPOLIA_RPC:-"https://sepolia.base.org"}

# Contract addresses (from deployment)
SWEEP_V2_CONTRACT=${SWEEP_V2_CONTRACT:-"0xc2f18d998AB364BeaCcAF95e50B8a959Ce6A5F78"}
OP_STACK_ADAPTER=${OP_STACK_ADAPTER:-"0x827463988bdadA6dFaA2dF75e8516F723117dC04"}

# Destination chain
DEST_CHAIN_ID=84532  # Base Sepolia

# Test funding (small amount for testing)
TEST_FUNDING=${TEST_FUNDING:-"50000000000000"}  # 0.00005 ETH

# Derive addresses
RELAYER_ADDRESS=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)

# Destination for bridged funds (defaults to relayer, override with DESTINATION env)
DESTINATION=${DESTINATION:-$RELAYER_ADDRESS}

# Verify chain IDs
SEPOLIA_CHAIN_ID=$(cast chain-id --rpc-url $SEPOLIA_RPC)
BASE_CHAIN_ID=$(cast chain-id --rpc-url $BASE_SEPOLIA_RPC)

echo ""
echo "Configuration:"
echo "  Source Chain: Sepolia ($SEPOLIA_CHAIN_ID)"
echo "  Destination Chain: Base Sepolia ($BASE_CHAIN_ID)"
echo "  V2 Contract: $SWEEP_V2_CONTRACT"
echo "  OPStackAdapter: $OP_STACK_ADAPTER"
echo "  Relayer: $RELAYER_ADDRESS"
echo "  Destination: $DESTINATION"
echo "  Test Funding: $TEST_FUNDING wei ($(cast from-wei $TEST_FUNDING) ETH)"

# Verify adapter is configured correctly
echo ""
echo "Verifying OPStackAdapter configuration..."
ADAPTER_BRIDGE=$(cast call $OP_STACK_ADAPTER "l1StandardBridge()(address)" --rpc-url $SEPOLIA_RPC)
ADAPTER_DEST_CHAIN=$(cast call $OP_STACK_ADAPTER "destinationChain()(uint256)" --rpc-url $SEPOLIA_RPC | awk '{print $1}')

echo "  L1StandardBridge: $ADAPTER_BRIDGE"
echo "  Destination Chain: $ADAPTER_DEST_CHAIN"

if [ "$ADAPTER_DEST_CHAIN" != "$DEST_CHAIN_ID" ]; then
    echo -e "${RED}ERROR: Adapter destination chain mismatch!${NC}"
    exit 1
fi

# Verify adapter is in V2 allowlist
IS_ALLOWED=$(cast call $SWEEP_V2_CONTRACT "isAllowedAdapter(address)(bool)" $OP_STACK_ADAPTER --rpc-url $SEPOLIA_RPC)
if [ "$IS_ALLOWED" != "true" ]; then
    echo -e "${RED}ERROR: OPStackAdapter is not in V2 allowlist!${NC}"
    exit 1
fi
echo -e "${GREEN}  Adapter verified and allowed!${NC}"

# =============================================================================
# Create test user
# =============================================================================
echo ""
echo -e "${YELLOW}Creating test user...${NC}"

if [ -n "$USER_PRIVATE_KEY" ]; then
    USER_ADDRESS=$(cast wallet address --private-key $USER_PRIVATE_KEY)
    echo "  Reusing: $USER_ADDRESS"
else
    USER_PRIVATE_KEY="0x$(openssl rand -hex 32)"
    USER_ADDRESS=$(cast wallet address --private-key $USER_PRIVATE_KEY)
    echo "  Generated: $USER_ADDRESS"
    echo "  Private key: $USER_PRIVATE_KEY"
    echo "  (Save this to reuse the address)"
fi

# Check and fund user
CURRENT_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $SEPOLIA_RPC)
echo "  Current Sepolia balance: $CURRENT_BALANCE wei"

if [ "$CURRENT_BALANCE" -lt "$TEST_FUNDING" ]; then
    echo "  Funding test user with $TEST_FUNDING wei..."
    FUND_TX=$(cast send $USER_ADDRESS --value $TEST_FUNDING --private-key $RELAYER_PRIVATE_KEY --rpc-url $SEPOLIA_RPC --json 2>&1)
    FUND_STATUS=$(echo $FUND_TX | jq -r '.status')

    if [ "$FUND_STATUS" != "0x1" ]; then
        echo -e "${RED}Failed to fund test user${NC}"
        echo "$FUND_TX"
        exit 1
    fi

    sleep 5
    CURRENT_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $SEPOLIA_RPC)
    echo "  New balance: $CURRENT_BALANCE wei"
fi

# Record initial balance on destination chain
INITIAL_DEST_BALANCE=$(cast balance $DESTINATION --rpc-url $BASE_SEPOLIA_RPC)
echo ""
echo "Initial Balances:"
echo "  User (Sepolia): $CURRENT_BALANCE wei"
echo "  Destination (Base Sepolia): $INITIAL_DEST_BALANCE wei"

# =============================================================================
# Build and sign cross-chain sweep authorization
# =============================================================================
echo ""
echo -e "${CYAN}Building cross-chain sweep authorization...${NC}"

USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $SEPOLIA_RPC)
MAX_RELAYER_FEE=$((USER_BALANCE / 2))  # Half for relayer
MIN_RECEIVE=1  # Minimum 1 wei (OP Stack bridges are 1:1)
DEADLINE=$(($(date +%s) + 3600))  # 1 hour
NONCE=0  # Fresh user
REFUND_RECIPIENT=$RELAYER_ADDRESS  # Must equal relayer per V2 rules

echo "  User: $USER_ADDRESS"
echo "  Balance: $USER_BALANCE wei"
echo "  Destination Chain: $DEST_CHAIN_ID"
echo "  Destination: $DESTINATION"
echo "  Relayer: $RELAYER_ADDRESS"
echo "  Adapter: $OP_STACK_ADAPTER"
echo "  Refund Recipient: $REFUND_RECIPIENT"
echo "  Max Relayer Fee: $MAX_RELAYER_FEE wei"
echo "  Min Receive: $MIN_RECEIVE wei"
echo "  Deadline: $DEADLINE"
echo "  Nonce: $NONCE"

# Get domain separator
DOMAIN_SEPARATOR=$(cast call $SWEEP_V2_CONTRACT "DOMAIN_SEPARATOR()(bytes32)" --rpc-url $SEPOLIA_RPC)
echo "  Domain Separator: $DOMAIN_SEPARATOR"

# Type hash for CrossChainSweep
CROSS_CHAIN_SWEEP_TYPEHASH="0x85674f956c6c9e743d9814c98b70584b3db3eb96a312632cf996662990b6b40f"

# Compute struct hash
echo ""
echo "Computing EIP-712 signature..."

STRUCT_HASH=$(cast keccak256 $(cast abi-encode \
    "x(bytes32,address,uint256,address,address,address,address,uint256,uint256,uint256,uint256)" \
    $CROSS_CHAIN_SWEEP_TYPEHASH \
    $USER_ADDRESS \
    $DEST_CHAIN_ID \
    $DESTINATION \
    $RELAYER_ADDRESS \
    $OP_STACK_ADAPTER \
    $REFUND_RECIPIENT \
    $MAX_RELAYER_FEE \
    $MIN_RECEIVE \
    $DEADLINE \
    $NONCE))
echo "  Struct Hash: $STRUCT_HASH"

# EIP-712 digest
DIGEST=$(cast keccak256 $(cast concat-hex "0x1901" $DOMAIN_SEPARATOR $STRUCT_HASH))
echo "  EIP-712 Digest: $DIGEST"

# Sign with user's key
SIGNATURE=$(cast wallet sign --no-hash --private-key $USER_PRIVATE_KEY $DIGEST)
echo "  Signature: ${SIGNATURE:0:42}..."

# Sign EIP-7702 delegation
echo ""
echo "Signing EIP-7702 delegation..."
SIGNED_AUTH=$(cast wallet sign-auth $SWEEP_V2_CONTRACT --private-key $USER_PRIVATE_KEY --rpc-url $SEPOLIA_RPC)
echo "  Signed Auth: ${SIGNED_AUTH:0:50}..."

# Empty adapter data (OP Stack doesn't need extra data)
ADAPTER_DATA="0x"

# Build calldata
CALLDATA=$(cast calldata \
    "executeCrossChainSweep((address,uint256,address,address,address,address,uint256,uint256,uint256,uint256),bytes,bytes)" \
    "($USER_ADDRESS,$DEST_CHAIN_ID,$DESTINATION,$RELAYER_ADDRESS,$OP_STACK_ADAPTER,$REFUND_RECIPIENT,$MAX_RELAYER_FEE,$MIN_RECEIVE,$DEADLINE,$NONCE)" \
    "$SIGNATURE" \
    "$ADAPTER_DATA")
echo "  Calldata: ${CALLDATA:0:66}..."

# =============================================================================
# Execute cross-chain sweep
# =============================================================================
echo ""
echo -e "${YELLOW}Executing REAL cross-chain sweep...${NC}"
echo -e "${YELLOW}Funds will be bridged from Sepolia to Base Sepolia!${NC}"

RESULT=$(cast send $USER_ADDRESS \
    $CALLDATA \
    --private-key $RELAYER_PRIVATE_KEY \
    --rpc-url $SEPOLIA_RPC \
    --auth $SIGNED_AUTH \
    --json 2>&1)

# Check for errors
if ! echo "$RESULT" | jq -e '.transactionHash' > /dev/null 2>&1; then
    echo -e "${RED}Transaction submission FAILED!${NC}"
    echo "Error: $RESULT"
    exit 1
fi

TX_HASH=$(echo $RESULT | jq -r '.transactionHash')
echo "  Transaction Hash: $TX_HASH"
echo "  Explorer: https://sepolia.etherscan.io/tx/$TX_HASH"

# Wait for receipt
sleep 5
RECEIPT=$(cast receipt $TX_HASH --rpc-url $SEPOLIA_RPC --json 2>&1)

if ! echo "$RECEIPT" | jq -e '.status' > /dev/null 2>&1; then
    echo -e "${RED}Failed to get receipt!${NC}"
    echo "Error: $RECEIPT"
    exit 1
fi

STATUS=$(echo $RECEIPT | jq -r '.status')
GAS_USED=$(echo $RECEIPT | jq -r '.gasUsed')

echo "  Status: $STATUS"
echo "  Gas Used: $GAS_USED"

if [ "$STATUS" != "0x1" ]; then
    echo -e "${RED}Transaction FAILED!${NC}"
    echo "Receipt: $RECEIPT"
    exit 1
fi

# =============================================================================
# Verify results
# =============================================================================
echo ""
echo "Final Balances (Sepolia):"
FINAL_USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $SEPOLIA_RPC)
FINAL_RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $SEPOLIA_RPC)
echo "  User: $FINAL_USER_BALANCE wei"
echo "  Relayer: $FINAL_RELAYER_BALANCE wei"

if [ "$FINAL_USER_BALANCE" == "0" ]; then
    echo ""
    echo -e "${GREEN}SUCCESS: User balance is exactly ZERO on Sepolia!${NC}"
else
    echo ""
    echo -e "${RED}FAILED: User balance is NOT zero: $FINAL_USER_BALANCE wei${NC}"
    exit 1
fi

# =============================================================================
# Instructions for verifying on Base Sepolia
# =============================================================================
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   CROSS-CHAIN SWEEP INITIATED!        ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo "The sweep transaction succeeded on Sepolia."
echo "ETH has been sent to the L1StandardBridge."
echo ""
echo "Bridge Details:"
echo "  Source: Sepolia (chain 11155111)"
echo "  Destination: Base Sepolia (chain 84532)"
echo "  Recipient: $DESTINATION"
echo ""
echo -e "${YELLOW}Bridge time: ~2-10 minutes for L1→L2${NC}"
echo ""
echo "To check if funds arrived on Base Sepolia:"
echo ""
echo "  cast balance $DESTINATION --rpc-url https://sepolia.base.org"
echo ""
echo "Or visit:"
echo "  https://sepolia.basescan.org/address/$DESTINATION"
echo ""
echo "Initial Base Sepolia balance: $INITIAL_DEST_BALANCE wei"
echo ""

# Optional: Poll for bridge completion
echo "Would you like to wait and check for bridge completion? (This may take several minutes)"
echo "Polling Base Sepolia for balance change..."

for i in {1..30}; do
    sleep 20
    NEW_DEST_BALANCE=$(cast balance $DESTINATION --rpc-url $BASE_SEPOLIA_RPC 2>/dev/null || echo "0")

    if [ "$NEW_DEST_BALANCE" != "$INITIAL_DEST_BALANCE" ]; then
        RECEIVED=$((NEW_DEST_BALANCE - INITIAL_DEST_BALANCE))
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}   BRIDGE COMPLETE!                    ${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo "  Received on Base Sepolia: $RECEIVED wei ($(cast from-wei $RECEIVED) ETH)"
        echo "  New balance: $NEW_DEST_BALANCE wei"
        echo ""
        echo -e "${GREEN}REAL CROSS-CHAIN SWEEP VERIFIED!${NC}"
        exit 0
    fi

    echo "  [$i/30] Waiting... (balance: $NEW_DEST_BALANCE wei)"
done

echo ""
echo -e "${YELLOW}Bridge still pending after 10 minutes.${NC}"
echo "This is normal - L1→L2 bridges can take time."
echo "Check manually at: https://sepolia.basescan.org/address/$DESTINATION"
