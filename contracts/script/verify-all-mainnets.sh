#!/bin/bash
# Verify EIP-7702 support on all mainnet chains with RPC URLs configured
# Usage: PRIVATE_KEY=0x... ./verify-all-mainnets.sh

set -e

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY not set"
    echo "Usage: PRIVATE_KEY=0x... ./verify-all-mainnets.sh"
    exit 1
fi

# Load .env from backend repo
BACKEND_DIR="/Users/dev/ZeroDust/zerodust-backend"
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo "Error: Backend .env not found at $BACKEND_DIR/.env"
    exit 1
fi

# Source .env
set -a
source "$BACKEND_DIR/.env"
set +a

# Test function
test_chain() {
    local name=$1
    local rpc_var=$2
    local rpc_url=${!rpc_var}

    if [ -z "$rpc_url" ]; then
        echo "⏭️  SKIPPED: $name (no RPC configured)"
        return
    fi

    echo ""
    echo "Testing $name..."
    ./script/verify-eip7702.sh "$name" "$rpc_url" || true
}

echo "╔════════════════════════════════════════════════════════╗"
echo "║         EIP-7702 Mainnet Support Verification         ║"
echo "╚════════════════════════════════════════════════════════╝"

# Already deployed (should pass)
test_chain "BSC" "RPC_URL_BSC"
test_chain "Polygon" "RPC_URL_POLYGON"
test_chain "Arbitrum" "RPC_URL_ARBITRUM"
test_chain "Base" "RPC_URL_BASE"

# New chains to test
test_chain "Ethereum" "RPC_URL_ETHEREUM"
test_chain "Optimism" "RPC_URL_OPTIMISM"
test_chain "Gnosis" "RPC_URL_GNOSIS"
test_chain "Scroll" "RPC_URL_SCROLL"
test_chain "Linea" "RPC_URL_LINEA"
test_chain "Zora" "RPC_URL_ZORA"
test_chain "Mode" "RPC_URL_MODE"
test_chain "Mantle" "RPC_URL_MANTLE"
test_chain "Celo" "RPC_URL_CELO"
test_chain "Blast" "RPC_URL_BLAST"
test_chain "Fraxtal" "RPC_URL_FRAXTAL"
test_chain "Unichain" "RPC_URL_UNICHAIN"
test_chain "World Chain" "RPC_URL_WORLDCHAIN"
test_chain "Berachain" "RPC_URL_BERACHAIN"
test_chain "Ink" "RPC_URL_INK"
test_chain "Plasma" "RPC_URL_PLASMA"
test_chain "BOB" "RPC_URL_BOB"
test_chain "Story" "RPC_URL_STORY"
test_chain "Superseed" "RPC_URL_SUPERSEED"
test_chain "Apechain" "RPC_URL_APECHAIN"
test_chain "Sei" "RPC_URL_SEI"
test_chain "Sonic" "RPC_URL_SONIC"
test_chain "Soneium" "RPC_URL_SONEIUM"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║                  Verification Complete                 ║"
echo "╚════════════════════════════════════════════════════════╝"
