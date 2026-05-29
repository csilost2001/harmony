# Harmony Dev Container OVERLAY (#1118 Phase 1)
#
# 目的: 頻繁更新ツールを base image に焼かず、薄い overlay 層に閉じ込めて
#       rebuild 時のコストを最小化。
#
# 階層構造:
#   .devcontainer/base/Dockerfile  ← Playwright + Chromium + apt (稀更新)
#   .devcontainer/Dockerfile       ← codex 等の頻繁更新ツール (本ファイル)
#
# 更新タイミング (頻繁、月単位):
#   - @openai/codex version bump (このファイルを編集 → Rebuild Container)
#   - 将来追加の頻繁更新 CLI も本ファイルに追記
#
# 計測:
#   - Phase 1 warm rebuild (Ryzen): 15 秒 (Phase 0 と同等、regression なし)
#   - Phase 2 cold start (新規開発者): ghcr.io から base image pull のみで完了
#
# base image 更新時の maintainer 手順は docs/setup/dev-containers.md の
# 「Maintainer: base image の更新と publish」を参照。
# `/publish-dev-image <version>` AI skill は **host bash で実行** すること
# (#1122 で container 内 docker CLI 廃止、ai-skills/publish-dev-image/SKILL.md)

FROM ghcr.io/csilost2001/harmony-devcontainer-base:0.3

USER root

# ripgrep (rg) — AI エージェント (Claude Code / Copilot CLI) が内部的にコード検索で
# 使うため同梱 (#1416)。Debian trixie main の apt パッケージ。codex 行の「上」に置くことで
# layer cache が効き、月次の codex version bump では再 install されない (再実行は base image
# bump / 本行編集 / cache クリア時のみ)。base image (#1120 Phase 5 inline) ではなく overlay に
# 置くのは、ghcr publish なしで次の Rebuild Container に即反映させるため (cold start の差は
# 数 MB の apt 1 パッケージ分で軽微)。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ripgrep \
  && rm -rf /var/lib/apt/lists/*

# @openai/codex (頻繁更新ツール、本 overlay 層に閉じ込め)
RUN npm install -g @openai/codex@0.130.0

USER node
