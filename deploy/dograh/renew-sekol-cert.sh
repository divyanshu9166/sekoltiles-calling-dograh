#!/bin/sh
set -eu

DOGRAH_CERT_DIR=/home/ubuntu/apps/dograh/certs
CRM_LE_DIR=/etc/letsencrypt/live/crm-80-225-228-198.sslip.io
DOGRAH_LE_DIR=/etc/letsencrypt/live/80-225-228-198.sslip.io

install -m 0644 "$CRM_LE_DIR/fullchain.pem" "$DOGRAH_CERT_DIR/crm.crt"
install -m 0600 "$CRM_LE_DIR/privkey.pem" "$DOGRAH_CERT_DIR/crm.key"

if [ -d "$DOGRAH_LE_DIR" ]; then
  install -m 0644 "$DOGRAH_LE_DIR/fullchain.pem" "$DOGRAH_CERT_DIR/local.crt"
  install -m 0600 "$DOGRAH_LE_DIR/privkey.pem" "$DOGRAH_CERT_DIR/local.key"
fi

if docker ps --format '{{.Names}}' | grep -qx nginx_https; then
  docker exec nginx_https nginx -s reload
fi
