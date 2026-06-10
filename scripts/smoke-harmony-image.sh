#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"
PORT="${HARMONY_SMOKE_PORT:-5179}"
CONTAINER_NAME="harmony-smoke-${PORT}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Run this script on the WSL2/Linux host, not inside the Dev Container." >&2
  exit 1
fi

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:5179" \
  -v "harmony-smoke-state:/home/node/.harmony" \
  -v "harmony-smoke-workspaces:/data/workspaces" \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/" | grep -qi '<!doctype html'

echo "Smoke passed for ${IMAGE} on port ${PORT}"
