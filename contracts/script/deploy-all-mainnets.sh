#!/bin/bash
# Deploy ZeroDust V3 to all new mainnet chains
# Usage: ./script/deploy-all-mainnets.sh

set -e

# Load .env from backend repo for RPC URLs
BACKEND_DIR="${BACKEND_DIR:?set BACKEND_DIR to the folder whose .env holds the RPC URLs}"
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo "Error: Backend .env not found at $BACKEND_DIR/.env"
    exit 1
fi

# Source .env
set -a
source "$BACKEND_DIR/.env"
set +a

# Check PRIVATE_KEY
if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY not set in .env"
    exit 1
fi

# Deploy function
deploy_chain() {
    local name=$1
    local rpc_var=$2
    local rpc_url=${!rpc_var}

    if [ -z "$rpc_url" ]; then
        echo "⏭️  SKIPPED: $name (no RPC configured)"
        return
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Deploying to $name..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    forge script script/DeployMainnet.s.sol:DeployMainnet \
        --rpc-url "$rpc_url" \
        --broadcast \
        --skip-simulation \
        -vv || echo "❌ FAILED: $name"
}

echo "╔════════════════════════════════════════════════════════╗"
echo "║         ZeroDust V3 Mainnet Deployment                ║"
echo "║   (Excluding: BSC, Polygon, Arbitrum, Base, Zora)     ║"
echo "╚════════════════════════════════════════════════════════╝"

# Deploy to 21 new chains
deploy_chain "Ethereum" "RPC_URL_ETHEREUM"
deploy_chain "Optimism" "RPC_URL_OPTIMISM"
deploy_chain "Gnosis" "RPC_URL_GNOSIS"
deploy_chain "Scroll" "RPC_URL_SCROLL"
deploy_chain "Mode" "RPC_URL_MODE"
deploy_chain "Mantle" "RPC_URL_MANTLE"
deploy_chain "Celo" "RPC_URL_CELO"
deploy_chain "Berachain" "RPC_URL_BERACHAIN"
deploy_chain "BOB" "RPC_URL_BOB"
deploy_chain "Story" "RPC_URL_STORY"
deploy_chain "Apechain" "RPC_URL_APECHAIN"
deploy_chain "Sonic" "RPC_URL_SONIC"
deploy_chain "Soneium" "RPC_URL_SONEIUM"
deploy_chain "Ink" "RPC_URL_INK"
deploy_chain "Sei" "RPC_URL_SEI"
deploy_chain "Unichain" "RPC_URL_UNICHAIN"
deploy_chain "World Chain" "RPC_URL_WORLDCHAIN"
deploy_chain "Plasma" "RPC_URL_PLASMA"
deploy_chain "Fraxtal" "RPC_URL_FRAXTAL"
deploy_chain "X Layer" "RPC_URL_XLAYER"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║              Deployment Complete                       ║"
echo "╚════════════════════════════════════════════════════════╝"
