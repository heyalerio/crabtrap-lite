#!/usr/bin/env bash
set -euo pipefail
export ACTION_GATE_HOST="${ACTION_GATE_HOST:-127.0.0.1}"
export ACTION_GATE_PORT="${ACTION_GATE_PORT:-8787}"
export ACTION_GATE_RECEIPT_MODE="${ACTION_GATE_RECEIPT_MODE:-truthful}"
exec node src/server.js
