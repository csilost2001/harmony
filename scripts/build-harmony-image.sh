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

# image に「どの commit から作ったか」を記録する (#1577)。git の作業コピーでなければ空で渡す (image は作れる)。
# 画面「連携と運用 → 版と更新」と designer__workspace_status が、これを読む
BUILD_COMMIT=""
BUILD_BRANCH=""
BUILD_DIRTY=""
BUILD_REPO=""
if command -v git >/dev/null 2>&1 && git rev-parse --show-toplevel >/dev/null 2>&1; then
  BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
  BUILD_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  # detached HEAD は "HEAD" と返る。ブランチ名ではないので、空で渡す (画面は「ブランチを特定できません」と出す)
  if [ "${BUILD_BRANCH}" = "HEAD" ]; then
    BUILD_BRANCH=""
  fi
  if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
    BUILD_DIRTY="true"
  else
    BUILD_DIRTY="false"
  fi
  # origin の URL (https://github.com/owner/repo(.git) / git@github.com:owner/repo(.git)) から owner/repo。GitHub でなければ空
  ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
  BUILD_REPO="$(printf '%s' "${ORIGIN_URL}" | sed -nE 's#^(https?://([^/@]+@)?|ssh://git@|git@)github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$#\3#p' | sed -E 's#\.git$##')"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -n "${BUILD_COMMIT}" ]; then
  echo "Building from commit ${BUILD_COMMIT:0:7} (ブランチ: ${BUILD_BRANCH:-特定できません})"
  if [ -z "${BUILD_BRANCH}" ]; then
    echo "注意: ブランチを特定できません (detached HEAD)。画面の「版と更新」に注意が出ます" >&2
  elif [ "${BUILD_BRANCH}" != "main" ]; then
    echo "注意: main ではなくブランチ '${BUILD_BRANCH}' から作ります。画面の「版と更新」に警告が出ます" >&2
  fi
  if [ "${BUILD_DIRTY}" = "true" ]; then
    echo "注意: コミットしていない変更があります。image には作業コピーのファイルが入りますが、記録されるのは commit だけです" >&2
  fi
else
  echo "注意: git の作業コピーではないため、image に commit を記録できません" >&2
fi

# リリースノート (画面「版と更新」が読む docs/release-notes.md) は、「その commit までの git の履歴」から決まる。
# commit 済みのファイルは PR 自身の題名を含められず、いつも 1 つ遅れる。そこで image を作るときに履歴から作り直し、
# 名前つき build context (releasenotes) で Dockerfile の `FROM scratch AS releasenotes` の段と差し替える。
# 作れないとき (git が無い・notes.mjs の失敗・build context に非対応の engine) は渡さず、commit 済みのファイルで作る
EXTRA_BUILD_ARGS=()
NOTES_DIR=""
cleanup_notes() { if [ -n "${NOTES_DIR}" ]; then rm -rf "${NOTES_DIR}"; fi; }
trap cleanup_notes EXIT
if [ -z "${BUILD_COMMIT}" ]; then
  echo "注意: git の履歴が使えないため、リリースノートは commit 済みの docs/release-notes.md のまま image に入ります" >&2
elif ! command -v node >/dev/null 2>&1; then
  echo "注意: node が無いため、リリースノートは commit 済みの docs/release-notes.md のまま image に入ります" >&2
elif ! "${ENGINE}" build --help 2>/dev/null | grep -q -- '--build-context'; then
  echo "注意: ${ENGINE} が --build-context に対応していないため、リリースノートは commit 済みの docs/release-notes.md のまま image に入ります (${ENGINE} を新しくすると、作るときの履歴から作れます)" >&2
else
  NOTES_DIR="$(mktemp -d)"
  if node scripts/release/notes.mjs --ref HEAD --stdout > "${NOTES_DIR}/release-notes.md" 2>"${NOTES_DIR}/notes.err" && [ -s "${NOTES_DIR}/release-notes.md" ]; then
    EXTRA_BUILD_ARGS=(--build-context "releasenotes=${NOTES_DIR}")
    echo "リリースノートを ${BUILD_COMMIT:0:7} までの履歴から作りました"
  else
    echo "注意: リリースノートを履歴から作れませんでした ($(head -c 200 "${NOTES_DIR}/notes.err" 2>/dev/null || true))。commit 済みの docs/release-notes.md のまま image に入ります" >&2
  fi
fi

"${ENGINE}" build --pull \
  ${EXTRA_BUILD_ARGS[@]+"${EXTRA_BUILD_ARGS[@]}"} \
  --build-arg NPM_VERSION="${NPM_VERSION}" \
  --build-arg HARMONY_BUILD_COMMIT="${BUILD_COMMIT}" \
  --build-arg HARMONY_BUILD_BRANCH="${BUILD_BRANCH}" \
  --build-arg HARMONY_BUILD_DIRTY="${BUILD_DIRTY}" \
  --build-arg HARMONY_BUILD_TIME="${BUILD_TIME}" \
  --build-arg HARMONY_BUILD_REPO="${BUILD_REPO}" \
  -t "${IMAGE}" .

echo "Built ${IMAGE} with ${ENGINE}"
