#!/bin/sh
# Coop Connect: run the server on a permanent public https link (macOS / Linux)
# using Tailscale Funnel. Install Tailscale first: https://tailscale.com/download
cd "$(dirname "$0")" || exit 1
PORT=${PORT:-3000}
command -v tailscale >/dev/null || { echo "Please install Tailscale first: https://tailscale.com/download"; exit 1; }
tailscale status >/dev/null 2>&1 || sudo tailscale up
[ -d node_modules ] || npm install
node server.js &
SERVER=$!
trap 'kill $SERVER' EXIT INT TERM
echo "Turning on the public link. The first time, open the link Tailscale shows and click Enable."
sudo tailscale funnel --bg "$PORT" || exit 1
echo
echo "Your permanent Coop Connect link (it never changes):"
tailscale funnel status
wait $SERVER
