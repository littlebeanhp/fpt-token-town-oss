#!/usr/bin/env sh
# Build and deploy to Cloudflare from a node:22 container, for machines whose
# system Node is older than .nvmrc. Credentials come from .env, which wrangler
# reads on its own. Extra arguments are passed through to `wrangler deploy`.
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$SRC/.env" ] || { echo "Missing $SRC/.env with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID" >&2; exit 1; }

# Build on a copy so a container-owned node_modules never lands in the checkout.
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
tar -C "$SRC" \
  --exclude=node_modules --exclude=.next --exclude=out --exclude=.git \
  --exclude=.local-assets \
  --exclude=test-results --exclude=playwright-report --exclude='*.tsbuildinfo' \
  -cf - . | tar -C "$BUILD" -xf -

docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -e NEXT_TELEMETRY_DISABLED=1 -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -e CI=1 -e WRANGLER_SEND_METRICS=false \
  -v "$BUILD":/app -w /app node:22-alpine \
  sh -c 'npm ci --no-audit --no-fund && npm run build && exec npx --yes wrangler@4 deploy "$@"' sh "$@"
