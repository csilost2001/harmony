#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"
ENGINE="${CONTAINER_ENGINE:-docker}"

if ! command -v "${ENGINE}" >/dev/null 2>&1; then
  echo "${ENGINE} command not found. Set CONTAINER_ENGINE=docker or CONTAINER_ENGINE=podman and run this on the host." >&2
  exit 1
fi

if ! "${ENGINE}" info >/dev/null 2>&1; then
  echo "${ENGINE} daemon/service is not reachable. Run this script on the host with Docker/Podman available." >&2
  exit 1
fi

"${ENGINE}" build -t "${IMAGE}" .

echo "Built ${IMAGE} with ${ENGINE}"
