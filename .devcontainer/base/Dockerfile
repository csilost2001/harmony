# Harmony Dev Container BASE image (#1118 Phase 1, #1120 Phase 5)
#
# 目的: 稀更新の重い install を base image に分離。
#   - Playwright + Chromium binary + apt system deps (~285 MiB + ~328 MB disk)
#   - Phase 5 (#1120): features inline — github-cli / claude-code / copilot-cli /
#     docker-outside-of-docker の install を base image に焼き、Dev Containers の
#     features apply による cold start オーバーヘッド (~50-60 秒 on Note PC) を削減
#   - chown -R で /home/node/.cache を node 所有に統一 (Copilot 等の他 tool 用)
#
# 更新タイミング (稀、年に数回程度):
#   - Playwright major/minor 更新 (frontend/package.json の version と同期)
#   - claude-code / copilot-cli の重大 version 更新 (auto-update を廃止したため、
#     版上げは base image bump 経由で行う)
#   - Node major 更新 (FROM タグの数字変更時)
#   - Debian release 切替 (FROM の suffix 変更時)
#
# overlay は .devcontainer/Dockerfile を参照 (codex 等の頻繁更新ツール)。
#
# 公開先 (Phase 2 で確立):
#   ghcr.io/csilost2001/harmony-devcontainer-base:<version>
# 利用者は overlay の FROM で自動 pull、Playwright DL + features install を回避。
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

# ============================================================================
# Phase 5 (#1120): features inlining
# ============================================================================
# 元 features (削除済 from devcontainer.json):
#   - ghcr.io/devcontainers/features/github-cli:1
#   - ghcr.io/anthropics/devcontainer-features/claude-code:1.0
#   - ghcr.io/devcontainers/features/copilot-cli:1.1.2
#   - ghcr.io/devcontainers/features/docker-outside-of-docker:1 (moby: false)
#
# Dev Containers の features は image build 後に CLI が apply する仕組みのため
# ghcr push に含まれず、毎回 cold start で install が走る (Note PC で ~50-60 秒)。
# base image に inline すれば pull 完了時点で install 済となり、cold start
# 大幅短縮 (Note PC cold 303 → ~150-180 秒、warm 41 → ~22 秒 を期待)。

# 1. github-cli (apt repo 経由 — 元 feature install.sh L237-243 と同等)
#    keyring は GitHub CLI 公式 (2024 改定) と docker の現代慣行に合わせて
#    /etc/apt/keyrings/ に統一 (#1120 review N-1)。
RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# 2. claude-code (npm global — 元 feature install.sh の install_claude_code() と同等)
#    Node は base image (typescript-node:20-trixie) に同梱済のため install skip。
RUN npm install -g @anthropic-ai/claude-code

# 3. copilot-cli (GitHub release tarball — 元 feature install.sh の install_using_github() と同等)
#    auto-update flag (/etc/devcontainer-copilot-cli/auto-update) は再現しない。
#    base image 焼き込み = pin、版上げは base image bump 経由で運用。
RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) arch=x64 ;; \
    arm64) arch=arm64 ;; \
    *) echo "Unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/github/copilot-cli/releases/latest/download/copilot-linux-${arch}.tar.gz" -o /tmp/copilot.tar.gz; \
  tar -xzf /tmp/copilot.tar.gz -C /tmp; \
  mv /tmp/copilot /usr/local/bin/copilot; \
  rm /tmp/copilot.tar.gz; \
  chmod +x /usr/local/bin/copilot

# 4. docker-outside-of-docker は本 P5b 構成では inline しない (host 側 publish 運用、#1122)。
#    publish-dev-image.sh は host bash で実行する (script 先頭で /.dockerenv 検出して reject)。
#    container 内に docker CLI が無いことで image size -~220 MB (uncompressed) /
#    -~115 MB (ghcr 圧縮 = registry 転送量)、GID 動的調整 / docker.sock bind /
#    SELinux 緩和も不要。

USER node
