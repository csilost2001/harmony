#!/usr/bin/env bash
# .devcontainer/scripts/publish-dev-image.sh — Phase 2 (#1118)
#
# Harmony Dev Container BASE image を ghcr.io に build + push する maintainer script。
#
# Usage:
#   bash .devcontainer/scripts/publish-dev-image.sh <version>
#   例: bash .devcontainer/scripts/publish-dev-image.sh 1.0
#
# 事前準備:
#   1. ghcr.io への push 権限がある GitHub PAT を発行 (write:packages scope 必須)
#   2. docker login ghcr.io -u <github-username>
#      → Password に PAT を入力
#
# 動作:
#   1. .devcontainer/base/Dockerfile から image を build
#   2. ghcr.io タグと local タグの両方を付与
#   3. ghcr.io に push
#
# push 後:
#   .devcontainer/Dockerfile の FROM 行を以下に更新する:
#     FROM ghcr.io/<username>/harmony-devcontainer-base:<version>
#
# Phase 3 で publish-dev-image AI skill から本 script を呼び出す予定 (ai-skills/)。

set -euo pipefail

# host 環境チェック (#1122 P5b 以降、Dev Container 内には docker CLI 無し)
if [[ -f /.dockerenv ]] || [[ -f /run/.containerenv ]]; then
  echo "[publish] ERROR: 本 script は host (WSL2 bash / Docker Desktop 等) で実行してください。" >&2
  echo "[publish]        Dev Container 内では実行できません (#1122 で container 内 docker CLI 廃止)。" >&2
  echo "[publish]" >&2
  echo "[publish]   host WSL2 bash で:" >&2
  echo "[publish]     cd ~/projects/harmony" >&2
  echo "[publish]     bash .devcontainer/scripts/publish-dev-image.sh ${1:-<version>}" >&2
  exit 1
fi

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "Usage: $0 <version>" >&2
  echo "  例: $0 1.0" >&2
  echo "  例: $0 1.1-rc1" >&2
  exit 1
fi

# ghcr.io username (Harmony 本家用、fork した場合は環境変数で override 可能)
GHCR_USER="${HARMONY_GHCR_USER:-csilost2001}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/../base"
GHCR_TAG="ghcr.io/${GHCR_USER}/harmony-devcontainer-base:${VERSION}"
LOCAL_TAG="harmony-devcontainer-base:local"

if ! command -v docker >/dev/null 2>&1; then
  echo "[publish] ERROR: docker command not found." >&2
  exit 1
fi

# ghcr.io ログイン状態を緩く確認 (失敗しても push 段階で再度確認される)
if ! docker info 2>/dev/null | grep -q "ghcr.io"; then
  echo "[publish] WARN: ghcr.io のログイン情報が docker info で確認できません。"
  echo "[publish]       push 時に認証エラーが出る場合は以下を実行してください:"
  echo "[publish]         docker login ghcr.io -u ${GHCR_USER}"
  echo "[publish]       (Password に write:packages scope の PAT を入力)"
fi

echo "[publish] Building ${GHCR_TAG} (local 用 ${LOCAL_TAG} もタグ付け)..."
docker build -t "${GHCR_TAG}" -t "${LOCAL_TAG}" "${BASE_DIR}"

echo "[publish] Pushing ${GHCR_TAG} to ghcr.io..."
docker push "${GHCR_TAG}"

echo
echo "[publish] 完了: ${GHCR_TAG}"
echo
echo "=== 次の手順 ==="
echo "  1. .devcontainer/Dockerfile の FROM 行を以下に更新:"
echo "       FROM ${GHCR_TAG}"
echo "  2. git commit + push"
echo "  3. Rebuild Container で動作確認"
echo "     (初回は ghcr.io から pull、~30 秒程度の見込み)"
