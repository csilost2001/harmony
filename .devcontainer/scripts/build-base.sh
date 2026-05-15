#!/usr/bin/env bash
# .devcontainer/scripts/build-base.sh — Phase 1 (#1118)
#
# Harmony Dev Container 用 base image を host 側で local build する manual ツール。
# Phase 2 以降は overlay (.devcontainer/Dockerfile) が ghcr.io URL を FROM 指定
# しており Dev Containers が pull で取得するため、本 script は通常不要。
#
# 用途 (maintainer のみ):
#   - base/Dockerfile を編集して、push 前にローカルで build 通過確認したい時
#   - ghcr.io にアクセスできないオフライン環境で動作確認したい時
#
# publish (= ghcr.io への push) する時は publish-dev-image.sh を使うこと。
#
# Docker layer cache が効くので 2 回目以降は秒で完了 (no-op に近い)。
# 強制 rebuild したい場合は事前に: docker rmi harmony-devcontainer-base:local

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/../base"
TAG="harmony-devcontainer-base:local"

if ! command -v docker >/dev/null 2>&1; then
  echo "[harmony-devcontainer] ERROR: docker command not found." >&2
  echo "  WSL2 + Docker Desktop もしくは WSL2 native Docker が必要です。" >&2
  exit 1
fi

echo "[harmony-devcontainer] base image ($TAG) を build (cache hit 時は秒で完了)..."
docker build -t "$TAG" "$BASE_DIR"
echo "[harmony-devcontainer] base image build 完了: $TAG"
