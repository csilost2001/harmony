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
# Dev Container 内から `/publish-dev-image <version>` AI skill 経由で更新可能
# (ai-skills/publish-dev-image/SKILL.md、Phase 3 で導入)

FROM ghcr.io/csilost2001/harmony-devcontainer-base:0.2

USER root

# @openai/codex (頻繁更新ツール、本 overlay 層に閉じ込め)
RUN npm install -g @openai/codex@0.130.0

USER node
