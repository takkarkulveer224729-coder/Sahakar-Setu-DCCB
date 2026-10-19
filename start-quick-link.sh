#!/bin/sh
# Coop Connect on a temporary public link (changes on every start) via Cloudflare quick tunnel.
cd "$(dirname "$0")" || exit 1
command -v cloudflared >/dev/null || { echo "Please install cloudflared first (macOS: brew install cloudflared)"; exit 1; }
[ -d node_modules ] || npm install
node server.js &
SERVER=$!
trap 'kill $SERVER' EXIT INT TERM
echo "Your temporary link appears below. Look for https://....trycloudflare.com"
cloudflared tunnel --no-autoupdate --url http://localhost:${PORT:-3000}
