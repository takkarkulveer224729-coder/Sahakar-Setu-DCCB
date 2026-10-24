#!/usr/bin/env bash
# Coop Connect: install on a Linux server (Google Cloud free e2-micro, or any Debian/Ubuntu VM).
#
#   sudo bash coop-connect/scripts/install-linux.sh [--import coop-data-backup.zip] [--hostname complianceofficer]
#
# It installs Node.js and Coop Connect, runs it as a service that starts on boot,
# optionally imports accounts/messages/files exported from the Windows PC, and
# publishes it with Tailscale Funnel under the given machine name, so the public
# link (https://<hostname>.<your-tailnet>.ts.net) stays the same as before.
set -euo pipefail

HOSTNAME_WANTED="${COOP_HOSTNAME:-complianceofficer}"
PORT="${PORT:-3000}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/coop-connect
STATE_DIR=/var/lib/coop-connect
IMPORT_ZIP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --import) IMPORT_ZIP="$(realpath "$2")"; shift 2 ;;
    --hostname) HOSTNAME_WANTED="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo:  sudo bash $0 $*"; exit 1; }
[ -f "$SRC_DIR/server.js" ] || { echo "Run this from the unzipped coop-connect folder."; exit 1; }
if [ -n "$IMPORT_ZIP" ] && [ ! -f "$IMPORT_ZIP" ]; then echo "File not found: $IMPORT_ZIP"; exit 1; fi

say "Installing system packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates unzip rsync >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi

# The free e2-micro has 1 GB of memory; a little swap keeps installs and spikes safe.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  say "Adding 1 GB of swap space"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Installing Coop Connect to $APP_DIR"
id coopconnect >/dev/null 2>&1 || useradd --system --home-dir "$STATE_DIR" --shell /usr/sbin/nologin coopconnect
mkdir -p "$APP_DIR" "$STATE_DIR/data" "$STATE_DIR/uploads"
# settings.env on the server is kept across updates.
rsync -a --delete --exclude node_modules --exclude data --exclude uploads --exclude logs --exclude settings.env "$SRC_DIR/" "$APP_DIR/"
if [ -f "$SRC_DIR/settings.env" ] && [ ! -f "$APP_DIR/settings.env" ]; then cp "$SRC_DIR/settings.env" "$APP_DIR/settings.env"; fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund >/dev/null)

if [ -n "$IMPORT_ZIP" ]; then
  say "Importing accounts, messages and files from $(basename "$IMPORT_ZIP")"
  systemctl stop coop-connect 2>/dev/null || true
  tmp="$(mktemp -d)"
  # Zips made on Windows may use "\" in paths: unzip converts them but exits with a
  # warning code, so check for the data below instead of trusting the exit code.
  unzip -q -o "$IMPORT_ZIP" -d "$tmp" 2>/dev/null || true
  # Some unzip versions keep "data\db.json" as one odd filename: turn "\" into folders.
  while IFS= read -r -d '' f; do
    rel="${f#"$tmp"/}"
    dest="$tmp/${rel//\\//}"
    mkdir -p "$(dirname "$dest")"
    mv "$f" "$dest"
  done < <(find "$tmp" -type f -name '*\\*' -print0)
  db="$(find "$tmp" -type f -path '*data/db.json' | head -n 1)"
  [ -n "$db" ] || { rm -rf "$tmp"; echo "No data/db.json found inside $IMPORT_ZIP"; exit 1; }
  base="$(dirname "$(dirname "$db")")"
  cp -a "$base/data/." "$STATE_DIR/data/"
  if [ -d "$base/uploads" ]; then cp -a "$base/uploads/." "$STATE_DIR/uploads/"; fi
  rm -rf "$tmp"
  echo "    Imported $(find "$STATE_DIR/uploads" -type f | wc -l) shared files and all accounts/messages."
fi
chown -R coopconnect:coopconnect "$STATE_DIR"

say "Setting up Coop Connect to run all the time (and after every restart)"
cat > /etc/systemd/system/coop-connect.service <<EOF
[Unit]
Description=Coop Connect chat server
After=network-online.target
Wants=network-online.target

[Service]
User=coopconnect
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATA_DIR=$STATE_DIR/data
Environment=UPLOAD_DIR=$STATE_DIR/uploads
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable coop-connect >/dev/null 2>&1
systemctl restart coop-connect
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { warn "Coop Connect did not start. See: sudo journalctl -u coop-connect -n 50"; exit 1; }
echo "    Coop Connect is running."

if ! command -v tailscale >/dev/null; then
  say "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled >/dev/null 2>&1

if tailscale status >/dev/null 2>&1; then
  tailscale set --hostname="$HOSTNAME_WANTED"
else
  say "Sign in to Tailscale"
  echo "    Open the link below on your phone or PC and sign in with the SAME account"
  echo "    you used on the old PC (so your link stays the same)."
  tailscale up --hostname="$HOSTNAME_WANTED"
fi

say "Turning on the public link (Tailscale Funnel)"
echo "    If a link to enable Funnel appears, open it and click Enable."
tailscale funnel --bg "$PORT"

name="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))})')"
echo
echo "================================================================"
echo "  Coop Connect is online at:"
echo "     https://$name"
echo "================================================================"
case "$name" in
  "$HOSTNAME_WANTED".*) echo "  This is the same link as before - nothing to change for users." ;;
  *)
    warn "The name '$HOSTNAME_WANTED' is still used by another machine (probably the old PC)."
    echo "    1. Open https://login.tailscale.com/admin/machines"
    echo "    2. Remove the OLD '$HOSTNAME_WANTED' machine (... -> Remove)"
    echo "    3. Run this again:  sudo tailscale set --hostname=$HOSTNAME_WANTED"
    echo "    Then your link is https://$HOSTNAME_WANTED.${name#*.} again."
    ;;
esac
echo
echo "Useful commands:"
echo "  sudo systemctl status coop-connect      # is it running?"
echo "  sudo journalctl -u coop-connect -f      # live log"
echo "  sudo systemctl restart coop-connect     # restart"
