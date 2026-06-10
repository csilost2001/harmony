#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Run this script on the WSL2/Linux host, not inside the Dev Container." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not reachable. Run this script on the host with Docker Desktop/Engine available." >&2
  exit 1
fi

docker build -t "${IMAGE}" .

echo "Built ${IMAGE}"
