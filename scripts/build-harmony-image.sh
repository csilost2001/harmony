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

# npm の最新の版を build-arg で渡す。新版が出たときだけ npm の層が作り直される (取れなければ latest)。--pull で node のパッチも取る (#1571)
NPM_VERSION="latest"
if command -v npm >/dev/null 2>&1; then
  NPM_VERSION="$(npm view npm version 2>/dev/null || true)"
  NPM_VERSION="${NPM_VERSION:-latest}"
fi

"${ENGINE}" build --pull --build-arg NPM_VERSION="${NPM_VERSION}" -t "${IMAGE}" .

echo "Built ${IMAGE} with ${ENGINE}"
