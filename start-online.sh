#!/bin/sh
# Coop Connect: run the server and give it a public https link (macOS / Linux).
# Needs Node.js and cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
cd "$(dirname "$0")" || exit 1
command -v cloudflared >/dev/null || { echo "Please install cloudflared first (macOS: brew install cloudflared)"; exit 1; }
[ -d node_modules ] || npm install
node server.js &
SERVER=$!
trap 'kill $SERVER' EXIT INT TERM
echo "Your public link appears below. Look for https://....trycloudflare.com"
cloudflared tunnel --no-autoupdate --url http://localhost:${PORT:-3000}
