#!/bin/bash

# =============================================================================
# ZeroDust E2E Test Script
# =============================================================================
# Tests the full EIP-7702 sweep flow on testnets supporting Pectra
#
# Prerequisites:
# - Testnet must support EIP-7702 (Sepolia has Pectra activated)
# - Fund USER_ADDRESS with small amount of ETH to sweep
# - Fund RELAYER_ADDRESS with gas for the transaction
#
# Usage:
#   export USER_PRIVATE_KEY=0x...
#   export RELAYER_PRIVATE_KEY=0x...
#   export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
#   ./script/e2e-test.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=============================================="
echo "        ZeroDust E2E Test with EIP-7702       "
echo "=============================================="

# Check required environment variables
if [ -z "$USER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: USER_PRIVATE_KEY not set${NC}"
    exit 1
fi

if [ -z "$RELAYER_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: RELAYER_PRIVATE_KEY not set${NC}"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
    echo -e "${YELLOW}Using default RPC: $RPC_URL${NC}"
fi

# Contract address (same on all chains via CREATE2, unless overridden)
SWEEP_CONTRACT=${SWEEP_CONTRACT:-"0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC"}

# Derive addresses from private keys
USER_ADDRESS=$(cast wallet address --private-key $USER_PRIVATE_KEY)
RELAYER_ADDRESS=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)

# Destination can be set or default to relayer
DESTINATION=${DESTINATION:-$RELAYER_ADDRESS}

echo ""
echo "Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  Sweep Contract: $SWEEP_CONTRACT"
echo "  User Address: $USER_ADDRESS"
echo "  Relayer Address: $RELAYER_ADDRESS"
echo "  Destination: $DESTINATION"

# Get chain ID
CHAIN_ID=$(cast chain-id --rpc-url $RPC_URL)
echo "  Chain ID: $CHAIN_ID"

# Check balances
USER_BALANCE=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)

echo ""
echo "Initial Balances:"
echo "  User: $USER_BALANCE wei ($(cast from-wei $USER_BALANCE) ETH)"
echo "  Relayer: $RELAYER_BALANCE wei ($(cast from-wei $RELAYER_BALANCE) ETH)"

if [ "$USER_BALANCE" == "0" ]; then
    echo -e "${RED}ERROR: User has no balance to sweep${NC}"
    exit 1
fi

# Get next nonce from contract
NONCE=$(cast call $SWEEP_CONTRACT "getNextNonce(address)(uint256)" $USER_ADDRESS --rpc-url $RPC_URL)
echo "  User's next sweep nonce: $NONCE"

# Authorization parameters
MAX_COMPENSATION="1000000000000000"  # 0.001 ETH in wei
DEADLINE=$(($(date +%s) + 3600))     # 1 hour from now

echo ""
echo "Authorization Parameters:"
echo "  Max Relayer Compensation: $MAX_COMPENSATION wei ($(cast from-wei $MAX_COMPENSATION) ETH)"
echo "  Deadline: $DEADLINE ($(date -r $DEADLINE 2>/dev/null || date -d @$DEADLINE))"
echo "  Nonce: $NONCE"

# Get domain separator from contract
DOMAIN_SEPARATOR=$(cast call $SWEEP_CONTRACT "DOMAIN_SEPARATOR()(bytes32)" --rpc-url $RPC_URL)
echo "  Domain Separator: $DOMAIN_SEPARATOR"

# EIP-712 typehash for SweepAuthorization
TYPEHASH="0xfe1248ae06418444fc99a808085043376c812f2163a190981dcd7b8af4d38046"

# Create struct hash
# keccak256(abi.encode(TYPEHASH, user, destination, maxRelayerCompensation, deadline, nonce))
STRUCT_HASH=$(cast keccak256 $(cast abi-encode "f(bytes32,address,address,uint256,uint256,uint256)" \
    $TYPEHASH \
    $USER_ADDRESS \
    $DESTINATION \
    $MAX_COMPENSATION \
    $DEADLINE \
    $NONCE))
echo "  Struct Hash: $STRUCT_HASH"

# Create EIP-712 digest
# keccak256("\x19\x01" || domainSeparator || structHash)
PACKED=$(echo -n "1901${DOMAIN_SEPARATOR:2}${STRUCT_HASH:2}" | xxd -r -p | xxd -p -c 66)
DIGEST=$(cast keccak256 "0x$PACKED")
echo "  EIP-712 Digest: $DIGEST"

# Sign the EIP-712 digest (SweepAuthorization)
# Use --no-hash because digest is already the final hash to sign
echo ""
echo "Signing EIP-712 SweepAuthorization..."
EIP712_SIGNATURE=$(cast wallet sign --private-key $USER_PRIVATE_KEY --no-hash $DIGEST)
echo "  Signature: ${EIP712_SIGNATURE:0:20}..."

# Sign EIP-7702 authorization (delegate user's EOA to sweep contract)
echo ""
echo "Signing EIP-7702 delegation..."
SIGNED_AUTH=$(cast wallet sign-auth $SWEEP_CONTRACT --private-key $USER_PRIVATE_KEY --rpc-url $RPC_URL)
echo "  Signed Auth: ${SIGNED_AUTH:0:40}..."

# Encode the executeSweep call
# executeSweep((address,address,uint256,uint256,uint256), bytes)
AUTH_TUPLE="($USER_ADDRESS,$DESTINATION,$MAX_COMPENSATION,$DEADLINE,$NONCE)"
CALLDATA=$(cast calldata "executeSweep((address,address,uint256,uint256,uint256),bytes)" \
    "$AUTH_TUPLE" \
    "$EIP712_SIGNATURE")
echo "  Calldata: ${CALLDATA:0:40}..."

# Execute the sweep
echo ""
echo -e "${YELLOW}Executing sweep transaction...${NC}"
echo "  Calling executeSweep on user's address with EIP-7702 auth"

# Send transaction with EIP-7702 authorization
TX_HASH=$(cast send $USER_ADDRESS $CALLDATA \
    --private-key $RELAYER_PRIVATE_KEY \
    --auth $SIGNED_AUTH \
    --rpc-url $RPC_URL \
    --json | jq -r '.transactionHash')

echo "  Transaction Hash: $TX_HASH"

# Wait for transaction
echo "  Waiting for confirmation..."
cast receipt $TX_HASH --rpc-url $RPC_URL --json | jq '{status, gasUsed, blockNumber}'

# Verify results
echo ""
echo "Final Balances:"
USER_BALANCE_AFTER=$(cast balance $USER_ADDRESS --rpc-url $RPC_URL)
RELAYER_BALANCE_AFTER=$(cast balance $RELAYER_ADDRESS --rpc-url $RPC_URL)
DEST_BALANCE_AFTER=$(cast balance $DESTINATION --rpc-url $RPC_URL)

echo "  User: $USER_BALANCE_AFTER wei ($(cast from-wei $USER_BALANCE_AFTER) ETH)"
echo "  Relayer: $RELAYER_BALANCE_AFTER wei"
echo "  Destination: $DEST_BALANCE_AFTER wei"

echo ""
if [ "$USER_BALANCE_AFTER" == "0" ]; then
    echo -e "${GREEN}✓ SUCCESS: User balance is exactly ZERO!${NC}"
    echo ""
    echo "The EIP-7702 sweep worked correctly:"
    echo "  - User's entire balance was swept"
    echo "  - Relayer received compensation (up to $MAX_COMPENSATION wei)"
    echo "  - Remainder sent to destination"
else
    echo -e "${RED}✗ FAILED: User still has balance: $USER_BALANCE_AFTER wei${NC}"
    exit 1
fi
