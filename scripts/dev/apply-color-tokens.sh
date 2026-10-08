#!/usr/bin/env bash
# apply-color-tokens — frontend のアプリ UI (CSS + inline style) の直書き色を配色トークンへ一括変換する。
# 上部ヘッダー (chrome)・設計対象アプリの canvas 用 CSS・カテゴリ色定義は対象外。
set -euo pipefail
cd "$(dirname "$0")/../../frontend/src"
CSS="styles/app.css styles/codexSettings.css styles/conventions.css styles/dashboard.css styles/dataList.css styles/editMode.css styles/editSessionDropdown.css styles/editorHeader.css styles/entityIdInput.css styles/er.css styles/errorFallback.css styles/extensions.css styles/flow.css styles/pageLayoutManager.css styles/processFlow.css styles/renameEntityDialog.css styles/resourceLoading.css styles/saveReset.css styles/screen-items.css styles/screenList.css styles/serverChangeBanner.css styles/tabbar.css styles/table.css styles/validation.css index.css"
TSX=$(grep -rlE "['\"][^'\"]*(#[0-9a-fA-F]{3,6}\b|rgba?\()" --include=*.tsx components | grep -v "test\|WorkspaceIndicator\|DrawingOverlay\|HeaderMenu\|CommonHeader" || true)
node ../../scripts/dev/tokenize-colors.mjs ${DRY:+--dry} \
  --default-dark table.css,saveReset.css,serverChangeBanner.css,TechStackView.tsx,WorkspaceSelectView.tsx,BackendFolderPicker.tsx,ErDiagram.tsx \
  $CSS $TSX | tail -1
