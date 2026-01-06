#!/usr/bin/env bash

# =============================================================================
# ZeroDust Multi-Chain E2E Test Script
# =============================================================================
# Tests EIP-7702 sweep on all deployed testnets
#
# Usage:
#   export PRIVATE_KEY=0x... && ./script/e2e-all-chains.sh
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Contract address (same on all chains via CREATE2)
SWEEP_CONTRACT="0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC"

# EIP-712 typehash
TYPEHASH="0xfe1248ae06418444fc99a808085043376c812f2163a190981dcd7b8af4d38046"

# Relayer private key from environment
RELAYER_PK="${PRIVATE_KEY}"

if [ -z "$RELAYER_PK" ]; then
    echo -e "${RED}ERROR: PRIVATE_KEY not set${NC}"
    exit 1
fi

RELAYER_ADDR=$(cast wallet address --private-key $RELAYER_PK)

# Results file
RESULTS_FILE="/tmp/zerodust_e2e_results.txt"
> $RESULTS_FILE

# Function to run E2E test on a single chain
test_chain() {
    local CHAIN_NAME=$1
    local RPC_URL=$2

    echo ""
    echo -e "${BLUE}=============================================="
    echo "Testing: $CHAIN_NAME"
    echo "RPC: $RPC_URL"
    echo "==============================================${NC}"

    # Check if chain is reachable
    CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "FAILED")
    if [ "$CHAIN_ID" == "FAILED" ]; then
        echo -e "${RED}✗ Chain unreachable${NC}"
        echo "$CHAIN_NAME|UNREACHABLE" >> $RESULTS_FILE
        return
    fi
    echo "Chain ID: $CHAIN_ID"

    # Check contract exists
    CODE=$(cast code $SWEEP_CONTRACT --rpc-url "$RPC_URL" 2>/dev/null | head -c 10)
    if [ "$CODE" == "0x" ] || [ -z "$CODE" ]; then
        echo -e "${RED}✗ Contract not deployed on this chain${NC}"
        echo "$CHAIN_NAME|NOT_DEPLOYED" >> $RESULTS_FILE
        return
    fi
    echo "Contract: Deployed ✓"

    # Check relayer balance
    RELAYER_BAL=$(cast balance $RELAYER_ADDR --rpc-url "$RPC_URL")
    RELAYER_ETH=$(cast from-wei $RELAYER_BAL 2>/dev/null || echo "0")
    echo "Relayer balance: $RELAYER_ETH"

    if [ "$RELAYER_BAL" == "0" ]; then
        echo -e "${YELLOW}⚠ No relayer funds - skipping${NC}"
        echo "$CHAIN_NAME|NO_FUNDS" >> $RESULTS_FILE
        return
    fi

    # Generate test user wallet for this chain
    TEST_USER_PK=$(cast wallet new --json | jq -r '.[0].private_key')
    TEST_USER_ADDR=$(cast wallet address --private-key $TEST_USER_PK)
    echo "Test user: $TEST_USER_ADDR"

    # Fund test user with small amount
    FUND_AMOUNT="0.0005"
    echo "Funding test user with $FUND_AMOUNT..."

    FUND_TX=$(cast send $TEST_USER_ADDR \
        --value ${FUND_AMOUNT}ether \
        --private-key $RELAYER_PK \
        --rpc-url "$RPC_URL" \
        --json 2>&1)

    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Failed to fund test user${NC}"
        echo "$CHAIN_NAME|FUND_FAILED" >> $RESULTS_FILE
        return
    fi

    FUND_STATUS=$(echo "$FUND_TX" | jq -r '.status' 2>/dev/null)
    if [ "$FUND_STATUS" != "0x1" ]; then
        echo -e "${RED}✗ Funding transaction failed${NC}"
        echo "$CHAIN_NAME|FUND_FAILED" >> $RESULTS_FILE
        return
    fi
    echo "Funded ✓"

    sleep 2

    # Verify test user balance
    USER_BAL=$(cast balance $TEST_USER_ADDR --rpc-url "$RPC_URL")
    echo "Test user balance: $(cast from-wei $USER_BAL)"

    if [ "$USER_BAL" == "0" ]; then
        echo -e "${RED}✗ Test user has no balance after funding${NC}"
        echo "$CHAIN_NAME|FUND_FAILED" >> $RESULTS_FILE
        return
    fi

    # Get nonce from contract
    NONCE=$(cast call $SWEEP_CONTRACT "getNextNonce(address)(uint256)" $TEST_USER_ADDR --rpc-url "$RPC_URL")

    # Authorization parameters
    MAX_COMP="100000000000000"
    DEADLINE=$(($(date +%s) + 3600))

    # Get domain separator
    DOMAIN_SEP=$(cast call $SWEEP_CONTRACT "DOMAIN_SEPARATOR()(bytes32)" --rpc-url "$RPC_URL")

    # Create struct hash
    STRUCT_HASH=$(cast keccak256 $(cast abi-encode "f(bytes32,address,address,uint256,uint256,uint256)" \
        $TYPEHASH \
        $TEST_USER_ADDR \
        $RELAYER_ADDR \
        $MAX_COMP \
        $DEADLINE \
        $NONCE))

    # Create EIP-712 digest
    PACKED=$(echo -n "1901${DOMAIN_SEP:2}${STRUCT_HASH:2}" | xxd -r -p | xxd -p -c 66)
    DIGEST=$(cast keccak256 "0x$PACKED")

    # Sign EIP-712 authorization
    EIP712_SIG=$(cast wallet sign --private-key $TEST_USER_PK --no-hash $DIGEST)

    # Sign EIP-7702 delegation
    SIGNED_AUTH=$(cast wallet sign-auth $SWEEP_CONTRACT --private-key $TEST_USER_PK --rpc-url "$RPC_URL" 2>&1)

    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠ EIP-7702 signing failed - chain may not support Pectra${NC}"
        echo "$CHAIN_NAME|NO_EIP7702" >> $RESULTS_FILE
        return
    fi

    # Encode calldata
    AUTH_TUPLE="($TEST_USER_ADDR,$RELAYER_ADDR,$MAX_COMP,$DEADLINE,$NONCE)"
    CALLDATA=$(cast calldata "executeSweep((address,address,uint256,uint256,uint256),bytes)" \
        "$AUTH_TUPLE" \
        "$EIP712_SIG")

    # Execute sweep with EIP-7702
    echo "Executing EIP-7702 sweep..."
    TX_RESULT=$(cast send $TEST_USER_ADDR "$CALLDATA" \
        --private-key $RELAYER_PK \
        --auth "$SIGNED_AUTH" \
        --rpc-url "$RPC_URL" \
        --json 2>&1)

    if [ $? -ne 0 ]; then
        if echo "$TX_RESULT" | grep -qi "authorization list not supported\|EIP-7702\|unsupported\|unknown field"; then
            echo -e "${YELLOW}⚠ EIP-7702 not supported on this chain${NC}"
            echo "$CHAIN_NAME|NO_EIP7702" >> $RESULTS_FILE
        else
            echo -e "${RED}✗ Transaction failed: $(echo "$TX_RESULT" | head -1)${NC}"
            echo "$CHAIN_NAME|TX_FAILED" >> $RESULTS_FILE
        fi
        return
    fi

    TX_HASH=$(echo "$TX_RESULT" | jq -r '.transactionHash')
    TX_STATUS=$(echo "$TX_RESULT" | jq -r '.status')

    if [ "$TX_STATUS" != "0x1" ]; then
        echo -e "${RED}✗ Transaction reverted${NC}"
        echo "$CHAIN_NAME|TX_REVERTED" >> $RESULTS_FILE
        return
    fi

    echo "Transaction: $TX_HASH"

    sleep 2

    # Verify final balance
    FINAL_BAL=$(cast balance $TEST_USER_ADDR --rpc-url "$RPC_URL")
    echo "Final balance: $FINAL_BAL wei"

    if [ "$FINAL_BAL" == "0" ]; then
        echo -e "${GREEN}✓ SUCCESS: Balance is exactly ZERO!${NC}"
        echo "$CHAIN_NAME|SUCCESS|$TX_HASH" >> $RESULTS_FILE
    else
        echo -e "${RED}✗ FAILED: Balance not zero ($FINAL_BAL wei remaining)${NC}"
        echo "$CHAIN_NAME|BALANCE_NOT_ZERO" >> $RESULTS_FILE
    fi
}

# Main execution
echo "=============================================="
echo "    ZeroDust Multi-Chain E2E Test Suite     "
echo "=============================================="
echo "Relayer: $RELAYER_ADDR"
echo "Contract: $SWEEP_CONTRACT"

# Test each chain
test_chain "sepolia" "https://ethereum-sepolia-rpc.publicnode.com"
test_chain "base_sepolia" "https://sepolia.base.org"
test_chain "arbitrum_sepolia" "https://sepolia-rollup.arbitrum.io/rpc"
test_chain "optimism_sepolia" "https://sepolia.optimism.io"
test_chain "bsc_testnet" "https://bsc-testnet-rpc.publicnode.com"
test_chain "polygon_amoy" "https://rpc-amoy.polygon.technology"
test_chain "gnosis_chiado" "https://rpc.chiadochain.net"
test_chain "unichain_sepolia" "https://sepolia.unichain.org"
test_chain "berachain_bepolia" "https://bepolia.rpc.berachain.com"
test_chain "plasma_testnet" "https://testnet-rpc.plasma.to"
test_chain "mantle_sepolia" "https://rpc.sepolia.mantle.xyz"

# Superchain testnets (EIP-7702 via Isthmus hardfork)
test_chain "ink_sepolia" "https://rpc-gel-sepolia.inkonchain.com"
test_chain "mode_sepolia" "https://sepolia.mode.network"
test_chain "zora_sepolia" "https://sepolia.rpc.zora.energy"
test_chain "soneium_minato" "https://rpc.minato.soneium.org"
test_chain "metal_testnet" "https://testnet.rpc.metall2.com"
test_chain "lisk_sepolia" "https://rpc.sepolia-api.lisk.com"
test_chain "worldchain_sepolia" "https://worldchain-sepolia.g.alchemy.com/public"

# Print summary
echo ""
echo ""
echo -e "${BLUE}=============================================="
echo "              TEST RESULTS SUMMARY            "
echo "==============================================${NC}"
echo ""

SUCCESS_COUNT=0

while IFS='|' read -r CHAIN_NAME RESULT TX_HASH; do
    case "$RESULT" in
        SUCCESS)
            echo -e "${GREEN}✓ $CHAIN_NAME: SUCCESS${NC}"
            echo "  TX: $TX_HASH"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            ;;
        NO_EIP7702)
            echo -e "${YELLOW}⚠ $CHAIN_NAME: EIP-7702 not yet supported (Pectra upgrade pending)${NC}"
            ;;
        NO_FUNDS)
            echo -e "${YELLOW}⚠ $CHAIN_NAME: No relayer funds${NC}"
            ;;
        NOT_DEPLOYED)
            echo -e "${YELLOW}⚠ $CHAIN_NAME: Contract not deployed${NC}"
            ;;
        UNREACHABLE)
            echo -e "${RED}✗ $CHAIN_NAME: Chain unreachable${NC}"
            ;;
        *)
            echo -e "${RED}✗ $CHAIN_NAME: $RESULT${NC}"
            ;;
    esac
done < $RESULTS_FILE

echo ""
echo "=============================================="
echo "EIP-7702 Sweep Success: $SUCCESS_COUNT chain(s)"
echo "=============================================="

if [ $SUCCESS_COUNT -gt 0 ]; then
    echo -e "${GREEN}ZeroDust sweep verified on $SUCCESS_COUNT chain(s)!${NC}"
fi

# Cleanup
rm -f $RESULTS_FILE
