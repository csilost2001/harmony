# Harmony Dev Container BASE image (#1118 Phase 1)
#
# 目的: 稀更新の重い install を base image に分離。
#   - Playwright + Chromium binary + apt system deps (~285 MiB + ~328 MB disk)
#   - chown -R で /home/node/.cache を node 所有に統一 (Copilot 等の他 tool 用)
#
# 更新タイミング (稀、年に数回程度):
#   - Playwright major/minor 更新 (frontend/package.json の version と同期)
#   - Node major 更新 (FROM タグの数字変更時)
#   - Debian release 切替 (FROM の suffix 変更時)
#
# overlay は .devcontainer/Dockerfile を参照 (codex 等の頻繁更新ツール)。
#
# 公開先 (Phase 2 で確立):
#   ghcr.io/csilost2001/harmony-devcontainer-base:<version>
# 利用者は overlay の FROM で自動 pull、Playwright DL を回避。
#
# 更新 (maintainer のみ):
#   bash .devcontainer/scripts/publish-dev-image.sh <new-version>
# 詳細手順: docs/setup/dev-containers.md「Maintainer: base image の更新と publish」

FROM mcr.microsoft.com/devcontainers/typescript-node:20-trixie

ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

USER root

# Playwright system libs (apt ~87 MB DL, ~328 MB disk, 66+ packages)
# + Chromium binary (~285 MiB) を 1 layer に焼く。chown は親 ~/.cache 全体に
# 効かせる (root 実行で作られた親 dir を node 所有に戻す。Copilot CLI の
# ~/.cache/copilot 等も書けるようにするため)。
RUN npx -y playwright@1.59.1 install --with-deps chromium \
  && chown -R node:node /home/node/.cache

USER node
