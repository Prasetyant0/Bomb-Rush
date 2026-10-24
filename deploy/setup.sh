#!/usr/bin/env bash
# BOMB RUSH — one-shot VPS setup. Idempotent: safe to re-run.
#
# Run as root:
#   scp -r deploy/ ubuntu@HOST:/tmp/bomb-deploy
#   ssh ubuntu@HOST 'sudo DOMAIN=app.example.com PORT=3100 bash /tmp/bomb-deploy/setup.sh'
#
# This script is written for a SHARED host. It never removes or edits another
# project's nginx site, never binds a port that is already in use, and refuses
# to continue if the chosen port is taken. Verify `PORT` and `DOMAIN` before
# running: the default it was first tested against turned out to host a live
# unrelated service on :3000.
#
# What it does:
#   1. installs Node 20, nginx, certbot
#   2. creates an unprivileged `bomb` service user
#   3. clones/updates the repo at /opt/bomb-rush
#   4. builds the server, writes .env (0600, owned by bomb)
#   5. installs a systemd unit and starts it
#   6. configures nginx to serve the static frontend AND proxy /api + /socket.io
#      to the same origin — one origin means no CORS, and defaultUrl() in the
#      frontend is then correct without an override
#   7. optionally obtains a TLS certificate
#
# It does NOT contain secrets. The settler key is read from /tmp/bomb-deploy.env
# if present, otherwise the chain module stays disabled and the game still runs.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-}"
PORT="${PORT:-3100}"
APP_DIR=/opt/bomb-rush
SERVICE_USER=bomb
ENV_FILE="$APP_DIR/.env"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mFAIL %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root (sudo bash setup.sh)"

# Refuse to bind a port another service already owns. This host may be shared;
# taking :3000 from a live unrelated stack is exactly the mistake this guards.
if ss -tln "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  die "port $PORT is already in use. Choose another with PORT=3101 ... and re-run."
fi

# ---------------------------------------------------------------- 1. packages
say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git nginx >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  say "installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v; npm -v

# ---------------------------------------------------------------- 2. user
say "service user"
# No -m: the account is a service identity, not a login. Giving it a home at
# APP_DIR would create the directory git clone then refuses to populate.
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin "$SERVICE_USER"

# ---------------------------------------------------------------- 3. repo
say "repository at $APP_DIR"
# The checkout belongs to SERVICE_USER but this script runs as root, so git
# refuses with "dubious ownership". Marking the one directory safe is narrower
# than relaxing ownership checks globally.
git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$APP_DIR" \
  || git config --global --add safe.directory "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  # Fetch and reset as the owner so the working tree stays owned by SERVICE_USER.
  sudo -u "$SERVICE_USER" git -C "$APP_DIR" fetch --all --quiet
  sudo -u "$SERVICE_USER" git -C "$APP_DIR" reset --hard origin/dev
elif [ -d "$APP_DIR" ] && [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  # Empty leftover directory: git clone into it is fine once we remove it.
  rmdir "$APP_DIR" 2>/dev/null || true
  [ -n "$REPO_URL" ] || die "REPO_URL unset and $APP_DIR is empty"
  git clone --branch dev "$REPO_URL" "$APP_DIR"
else
  [ -n "$REPO_URL" ] || die "REPO_URL unset and $APP_DIR is not a git checkout"
  git clone --branch dev "$REPO_URL" "$APP_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# ---------------------------------------------------------------- 4. build
say "build"
sudo -u "$SERVICE_USER" bash -lc "cd $APP_DIR && npm ci --include=dev --no-audit --no-fund"

# ORDER MATTERS: the server imports @bomb-rush/shared, whose package.json points
# at dist/index.js. Building the server first fails with TS2307 because that
# file does not exist yet. Shared must be compiled before its consumers.
sudo -u "$SERVICE_USER" bash -lc "cd $APP_DIR && npm run build --workspace @bomb-rush/shared"
[ -f "$APP_DIR/packages/shared/dist/index.js" ] || die "shared build produced no dist/index.js"

sudo -u "$SERVICE_USER" bash -lc "cd $APP_DIR && npm run build --workspace @bomb-rush/server"
[ -f "$APP_DIR/apps/server/dist/index.js" ] || die "server build produced no dist/index.js"

# ---------------------------------------------------------------- 5. env
say "environment file"
if [ ! -f "$ENV_FILE" ]; then
  # Values verified on chain 2026-10-24. Never take these from
  # contracts/broadcast/* — local anvil runs share chainId 10143 and pollute it.
  cat > "$ENV_FILE" <<ENVEOF
NODE_ENV=production
PORT=${PORT}
HOST=127.0.0.1
LOG_LEVEL=info

# Monad Testnet. Contract verified on both explorers.
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143
ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe
ESCROW_DEPLOYMENT_BLOCK=73756739

# Filled from /tmp/bomb-deploy.env when present. Empty = chain module disabled,
# game still runs, no settlement.
SERVER_SETTLER_PRIVATE_KEY=

# Set by setup.sh once DOMAIN is known.
ALLOWED_ORIGINS=
ENVEOF
  chmod 600 "$ENV_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  warn "wrote $ENV_FILE (chain disabled until a settler key is added)"
else
  say "keeping existing $ENV_FILE"
fi

# PORT and ALLOWED_ORIGINS are owned by the deploy, not by the operator: they
# describe where this script put the service and which hostname fronts it.
# Leaving a stale PORT from an earlier run is how the service ended up trying
# to bind :3000, which another application owns.
if grep -q '^PORT=' "$ENV_FILE"; then
  sed -i "s|^PORT=.*|PORT=${PORT}|" "$ENV_FILE"
else
  printf 'PORT=%s\n' "$PORT" >> "$ENV_FILE"
fi
if grep -q '^HOST=' "$ENV_FILE"; then
  sed -i "s|^HOST=.*|HOST=127.0.0.1|" "$ENV_FILE"
else
  printf 'HOST=127.0.0.1\n' >> "$ENV_FILE"
fi
say "env PORT=$PORT"

# Inject the settler key if the operator staged one next to this script.
if [ -f /tmp/bomb-deploy.env ]; then
  # shellcheck disable=SC1091
  . /tmp/bomb-deploy.env
  if [ -n "${SERVER_SETTLER_PRIVATE_KEY:-}" ]; then
    sed -i "s|^SERVER_SETTLER_PRIVATE_KEY=.*|SERVER_SETTLER_PRIVATE_KEY=${SERVER_SETTLER_PRIVATE_KEY}|" "$ENV_FILE"
    say "settler key installed from /tmp/bomb-deploy.env"
    shred -u /tmp/bomb-deploy.env 2>/dev/null || rm -f /tmp/bomb-deploy.env
  fi
fi

if [ -n "$DOMAIN" ]; then
  sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${DOMAIN}|" "$ENV_FILE"
fi

grep -q '^SERVER_SETTLER_PRIVATE_KEY=.\+' "$ENV_FILE" \
  && warn "chain module ENABLED (settler key present)" \
  || warn "chain module DISABLED (no settler key) — settlement will be skipped"

# ---------------------------------------------------------------- 6. systemd
say "systemd unit"
cat > /etc/systemd/system/bomb-rush.service <<'UNITEOF'
[Unit]
Description=BOMB RUSH 3D game server (Fastify + Socket.IO)
After=network.target

[Service]
Type=simple
User=bomb
Group=bomb
WorkingDirectory=/opt/bomb-rush
EnvironmentFile=/opt/bomb-rush/.env
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
RestartSec=3
# Hardening: the process needs no privileges beyond its own directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/bomb-rush
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now bomb-rush
sleep 2
systemctl is-active --quiet bomb-rush || { journalctl -u bomb-rush -n 30 --no-pager; die "service failed to start"; }

# ---------------------------------------------------------------- 7. nginx
say "nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/bomb-rush <<NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    root /opt/bomb-rush/apps/web;
    index index.html;

    # Static frontend. No build step: the app is plain ES modules.
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \\.(js|css|png|jpg|jpeg|svg|mp3|wav|glb|gltf)\$ {
        expires 1h;
        add_header Cache-Control "public";
        try_files \$uri =404;
    }

    # REST
    location /api/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:${PORT}/health;
        proxy_set_header Host \$host;
    }

    # Socket.IO — WebSocket upgrade headers are mandatory; without them the
    # client silently falls back to polling and the match desyncs.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/bomb-rush /etc/nginx/sites-enabled/bomb-rush
# Deliberately NOT removing sites-enabled/default or any other project's site.
# This host may serve other applications; a setup script has no business
# deleting someone else's vhost. If a default site shadows this one, that is a
# human decision, not a deploy step.
nginx -t || die "nginx config invalid — nothing was reloaded"
systemctl reload nginx

# ---------------------------------------------------------------- 8. TLS
if [ -n "$DOMAIN" ]; then
  say "TLS for $DOMAIN"
  if command -v certbot >/dev/null; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
      || warn "certbot failed — DNS may not point here yet. Re-run: certbot --nginx -d $DOMAIN"
  else
    warn "certbot missing; run: apt-get install -y certbot python3-certbot-nginx"
  fi
else
  warn "DOMAIN unset — HTTP only. Set DOMAIN=app.example.com and re-run for TLS."
fi

# ---------------------------------------------------------------- 9. verify
say "verification"
curl -fsS http://127.0.0.1:${PORT}/health | head -c 400; echo
curl -fsS -o /dev/null -w 'frontend HTTP %{http_code}\n' "http://127.0.0.1/" || warn "frontend not served"

say "done"
echo "  service : systemctl status bomb-rush"
echo "  logs    : journalctl -u bomb-rush -f"
echo "  env     : $ENV_FILE (0600, owned by $SERVICE_USER)"
echo "  chain   : $(grep -q '^SERVER_SETTLER_PRIVATE_KEY=.\+' "$ENV_FILE" && echo ENABLED || echo DISABLED)"
