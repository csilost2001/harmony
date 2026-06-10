#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"
PORT="${HARMONY_PORT:-5179}"
ENGINE="${CONTAINER_ENGINE:-docker}"
PROJECT_NAME="${HARMONY_COMPOSE_PROJECT:-harmony-smoke-compose}"
export HARMONY_IMAGE="${IMAGE}"

if ! command -v "${ENGINE}" >/dev/null 2>&1; then
  echo "${ENGINE} command not found. Set CONTAINER_ENGINE=docker or CONTAINER_ENGINE=podman and run this on the host." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node command not found. Run this script from the Harmony host checkout after npm install." >&2
  exit 1
fi

compose() {
  if "${ENGINE}" compose version >/dev/null 2>&1; then
    "${ENGINE}" compose -p "${PROJECT_NAME}" "$@"
    return
  fi

  if [ "${ENGINE}" = "podman" ] && command -v podman-compose >/dev/null 2>&1; then
    podman-compose -p "${PROJECT_NAME}" "$@"
    return
  fi

  echo "${ENGINE} compose is not available. Install Docker Compose v2, Podman Compose, or podman-compose." >&2
  exit 1
}

cleanup() {
  compose down >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose up -d

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/" | grep -qi '<!doctype html'
curl -fsS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"harmony-compose-smoke","version":"1"}}}' \
  "http://127.0.0.1:${PORT}/mcp" | grep -q 'harmony-mcp'

HARMONY_SMOKE_PORT="${PORT}" node -e '
const WebSocket = require("ws");
const port = process.env.HARMONY_SMOKE_PORT;
const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
  headers: {
    Origin: `http://127.0.0.1:${port}`,
    Host: `127.0.0.1:${port}`,
  },
});
const timer = setTimeout(() => {
  console.error("WebSocket compose smoke timeout");
  process.exit(1);
}, 3000);
ws.once("open", () => {
  clearTimeout(timer);
  ws.close();
});
ws.once("error", (err) => {
  clearTimeout(timer);
  console.error(err.message);
  process.exit(1);
});
'

echo "Compose smoke passed for ${HARMONY_IMAGE} on port ${PORT}"
