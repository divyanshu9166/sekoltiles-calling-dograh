#!/usr/bin/env bash
# One-time WhatsApp Marketing setup on the VPS. Safe to re-run.
#   bash scripts/setup-whatsapp-vps.sh
# Then restart the CRM and fill in WhatsApp Marketing -> Settings.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env in $(pwd) - create it first."; exit 1; }

# Add a .env value only when the key is missing; existing values are kept.
add_env() {
  if grep -q "^$1=" .env; then
    echo "  $1 already set - kept"
  else
    printf '\n%s="%s"\n' "$1" "$2" >> .env
    echo "  $1 added"
  fi
}

echo "1/4 .env values"
# Encrypts saved WhatsApp tokens/secrets. Never change it once WhatsApp is configured.
add_env ENCRYPTION_KEY "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
# Own Redis on 6380 so it never clashes with Dograh's Redis.
add_env REDIS_URL "redis://localhost:6380"
add_env TRANSFORMERS_CACHE_DIR ".model-cache"

echo "2/4 Redis 7 for automations and the AI agent (BullMQ needs Redis >= 5)"
if ! command -v docker >/dev/null 2>&1; then
  echo "  docker not found - install Redis >= 5 yourself and point REDIS_URL at it"
elif docker ps --format '{{.Names}}' | grep -qx wa-redis; then
  echo "  wa-redis already running"
elif docker ps -a --format '{{.Names}}' | grep -qx wa-redis; then
  docker start wa-redis >/dev/null && echo "  wa-redis started"
else
  docker run -d --name wa-redis --restart unless-stopped \
    -p 127.0.0.1:6380:6379 -v wa-redis-data:/data redis:7 redis-server --appendonly yes >/dev/null
  echo "  wa-redis created on 127.0.0.1:6380"
fi

echo "3/4 dependencies"
npm install
npx prisma generate

echo "4/4 database migrations (adds the WhatsApp tables)"
npm run db:migrate

echo
echo "Done. Restart the CRM, then open WhatsApp Marketing -> Settings."
