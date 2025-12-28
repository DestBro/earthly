#!/bin/bash
# This script runs ON the VPS during deployment
# It's uploaded and executed by the main deploy script

set -e

echo "🔧 Setting up environment..."

# Load Bun and Go into PATH
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"

# Verify required tools
command -v bun >/dev/null 2>&1 || { echo "❌ Bun not found"; exit 1; }
command -v go >/dev/null 2>&1 || { echo "❌ Go not found"; exit 1; }

echo "✓ Using Bun: $(which bun)"
echo "✓ Using Go: $(which go)"

# Extract deployment archive
echo "📦 Extracting files..."
tar -xzf deploy.tar.gz
rm deploy.tar.gz

# Install dependencies (only if node_modules missing)
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install --production
fi

# Download pmtiles-cli if missing (Linux x86_64 binary)
if [ ! -f "pmtiles-cli" ]; then
    echo "📦 Downloading pmtiles-cli..."
    curl -L https://github.com/protomaps/go-pmtiles/releases/download/v1.29.1/go-pmtiles_1.29.1_Linux_x86_64.tar.gz -o pmtiles.tar.gz
    tar -xzf pmtiles.tar.gz pmtiles
    mv pmtiles pmtiles-cli
    rm pmtiles.tar.gz
    chmod +x pmtiles-cli
    echo "✅ pmtiles-cli downloaded"
fi


# Create logs directory
mkdir -p logs

# Reload Caddy (optional, requires passwordless sudo)
if sudo -n cp Caddyfile /etc/caddy/Caddyfile 2>/dev/null && \
   sudo -n systemctl reload caddy 2>/dev/null; then
    echo "✅ Caddy configuration reloaded"
else
    echo "⚠️  Caddy reload skipped (run manually if needed)"
fi

# Restart PM2 processes
echo "🔄 Restarting services..."
pm2 delete all 2>/dev/null || true

# Start each service with explicit settings
# Using Bun interpreter for TypeScript files
BUN_PATH="$HOME/.bun/bin/bun"

NODE_ENV=production PORT=3000 pm2 start src/index.ts \
    --name earthly-web \
    --interpreter "$BUN_PATH" \
    --max-memory-restart 1G \
    --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
    -e logs/web-error.log \
    -o logs/web-out.log \
    --merge-logs

NODE_ENV=production pm2 start contextvm/server.ts \
    --name earthly-contextvm \
    --interpreter "$BUN_PATH" \
    --max-memory-restart 500M \
    --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
    -e logs/contextvm-error.log \
    -o logs/contextvm-out.log \
    --merge-logs

NODE_ENV=production BLOSSOM_PORT=3001 pm2 start src/blossom.ts \
    --name earthly-blossom \
    --interpreter "$BUN_PATH" \
    --max-memory-restart 500M \
    --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
    -e logs/blossom-error.log \
    -o logs/blossom-out.log \
    --merge-logs

pm2 save

echo ""
echo "✅ Deployment complete!"
pm2 list
