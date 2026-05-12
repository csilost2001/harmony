#!/usr/bin/env bash
# Regenerate TypeScript bindings for the Codex App Server protocol.
#
# Output: backend/src/codex/types/ (root + v2 subdirectory, ~545 files)
# Source: `codex app-server generate-ts` (codex-cli >= 0.128.0)
#
# Run from repo root: `bash scripts/generate/codex-types.sh`
# The generated files carry "// GENERATED CODE! DO NOT MODIFY BY HAND!" headers
# and are committed so consumers do not need codex CLI installed to build.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/backend/src/codex/types"

if ! command -v codex >/dev/null 2>&1; then
  echo "error: codex CLI not found in PATH" >&2
  echo "  install: npm install -g @openai/codex" >&2
  exit 1
fi

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

codex app-server generate-ts --out "${OUT_DIR}" --experimental

echo "regenerated: ${OUT_DIR}"
