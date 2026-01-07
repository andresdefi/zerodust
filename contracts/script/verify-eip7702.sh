#!/bin/bash
# EIP-7702 Chain Support Verification Script
# Usage: ./verify-eip7702.sh <chain_name> <rpc_url>

set -e

CHAIN_NAME=${1:-"Unknown"}
RPC_URL=${2:-""}
CONTRACT="0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC"

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY not set"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    echo "Error: RPC URL required"
    exit 1
fi

echo "=== EIP-7702 Verification: $CHAIN_NAME ==="

# Get chain ID
CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "error")
if [ "$CHAIN_ID" = "error" ]; then
    echo "❌ RPC not responding"
    exit 1
fi
echo "Chain ID: $CHAIN_ID"

# Sign authorization
echo "Signing EIP-7702 authorization..."
AUTH=$(cast wallet sign-auth $CONTRACT --private-key $PRIVATE_KEY --rpc-url "$RPC_URL" 2>&1)
if [[ ! "$AUTH" =~ ^0x ]]; then
    echo "❌ Authorization signing failed: $AUTH"
    exit 1
fi
echo "Authorization signed successfully"

# Try to send type-4 transaction
echo "Testing type-4 transaction acceptance..."
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY)
RESULT=$(cast send "$DEPLOYER" --value 0 --private-key $PRIVATE_KEY --auth "$AUTH" --rpc-url "$RPC_URL" 2>&1 || true)

if echo "$RESULT" | grep -qi "not supported\|invalid transaction type\|unknown tx type\|unsupported tx type"; then
    echo ""
    echo "❌ EIP-7702 NOT SUPPORTED on $CHAIN_NAME (Chain ID: $CHAIN_ID)"
    echo "   Error: $(echo "$RESULT" | head -1)"
    exit 1
elif echo "$RESULT" | grep -qi "insufficient\|balance"; then
    echo ""
    echo "✅ EIP-7702 SUPPORTED on $CHAIN_NAME (Chain ID: $CHAIN_ID)"
    echo "   (Transaction type accepted, just needs gas funds)"
elif echo "$RESULT" | grep -qi "transactionHash\|status.*success\|0x[a-f0-9]\{64\}"; then
    echo ""
    echo "✅ EIP-7702 SUPPORTED on $CHAIN_NAME (Chain ID: $CHAIN_ID)"
    echo "   (Transaction executed successfully)"
else
    echo ""
    echo "⚠️  UNCLEAR RESULT on $CHAIN_NAME (Chain ID: $CHAIN_ID)"
    echo "   Response: $RESULT"
fi
