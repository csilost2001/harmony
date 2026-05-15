# Harmony Dev Container — Phase 0 (#1118)
#
# 目的: rebuild 高速化のため、Playwright + codex の重い install を Docker layer に
#       焼く。postCreateCommand に残すのは source 依存 / mount 依存のもののみ
#       (npm install --prefix / .claude/.config.json 初期化)。
#
# 計測 (Ryzen 5950X, 10Gbps wired): warm rebuild 56 秒 → ~13-17 秒目標
#       (Note PC + Wi-Fi): warm rebuild 94 秒 → ~25-30 秒目標
#
# 階層構造 (Phase 1 で分離予定):
#   FROM mcr.microsoft.com/devcontainers/typescript-node:20-bullseye
#   ├── Playwright + Chromium + apt deps (Phase 1 で .devcontainer/base/Dockerfile に移動)
#   └── @openai/codex global install (Phase 1 で本 Dockerfile を overlay 層として残す、頻繁更新枠)

FROM mcr.microsoft.com/devcontainers/typescript-node:20-bullseye

# Playwright cache path (devcontainer.json の containerEnv と一致させる)
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

USER root

# Playwright system libs (apt-get で ~87 MB DL, ~328 MB disk, 66+ packages)
# + Chromium binary (~285 MiB) を 1 layer に焼く。chown で node user 所有に統一。
RUN npx -y playwright@1.59.1 install --with-deps chromium \
  && chown -R node:node /home/node/.cache/ms-playwright

# global npm tool (Phase 1 で overlay 層に分離予定、codex は頻繁更新前提)
RUN npm install -g @openai/codex@0.130.0

USER node
