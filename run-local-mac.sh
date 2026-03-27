#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
NODE_ROOT="/Users/gordo/.local/node/node-v22.22.2-darwin-arm64"
export PATH="${NODE_ROOT}/bin:${PATH}"

if [[ ! -x "${NODE_ROOT}/bin/node" ]]; then
  echo "Node.js was not found at ${NODE_ROOT}."
  exit 1
fi

cd "${SCRIPT_DIR}"

if [[ ! -d node_modules ]]; then
  npm install
fi

PORT_VALUE="${PORT:-3010}"
HOST_VALUE="${OW_HOST:-127.0.0.1}"
PUBLIC_ORIGIN_VALUE="${PUBLIC_ORIGIN:-http://localhost:${PORT_VALUE}}"

exec env HOST="${HOST_VALUE}" PORT="${PORT_VALUE}" PUBLIC_ORIGIN="${PUBLIC_ORIGIN_VALUE}" npm start
