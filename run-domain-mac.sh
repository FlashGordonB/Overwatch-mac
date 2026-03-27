#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DOMAIN="${DOMAIN:-spin.bownsfam.app}"
PORT_VALUE="${PORT:-3010}"
HOST_VALUE="${OW_HOST:-127.0.0.1}"
PUBLIC_ORIGIN_VALUE="${PUBLIC_ORIGIN:-https://${DOMAIN}}"

cd "${SCRIPT_DIR}"

echo "Starting app for ${PUBLIC_ORIGIN_VALUE} ..."
OW_HOST="${HOST_VALUE}" PORT="${PORT_VALUE}" PUBLIC_ORIGIN="${PUBLIC_ORIGIN_VALUE}" ./run-local-mac.sh &
APP_PID=$!

cleanup() {
  if kill -0 "${APP_PID}" >/dev/null 2>&1; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Caddy for ${DOMAIN} ..."
echo "You may be prompted for your password because binding to ports 80/443 requires sudo on macOS."
sudo env PATH="/Users/gordo/.local/bin:${PATH}" caddy run --config "${SCRIPT_DIR}/Caddyfile"
