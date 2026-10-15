/** 部品パレットの分類と部品の一覧 (パレットと、部品の追加メニュー (/) が共有する) */
import type { LayoutNodeType } from "@harmony/shared";

export const GROUPS: Array<{ title: string; types: Array<{ type: LayoutNodeType; icon: string; hint: string }> }> = [
  {
    title: "画面の構成",
    types: [
      { type: "section", icon: "bi-card-heading", hint: "表題付きの枠" },
      { type: "form", icon: "bi-ui-checks-grid", hint: "入力項目を列で並べる" },
      { type: "search-panel", icon: "bi-search", hint: "検索条件の入力欄" },
      { type: "columns", icon: "bi-layout-three-columns", hint: "左右に段を分ける" },
      { type: "tabs", icon: "bi-segmented-nav", hint: "タブで切り替える" },
      { type: "button-bar", icon: "bi-menu-button-wide", hint: "ボタンを横に並べる" },
    ],
  },
  {
    title: "要素",
    types: [
      { type: "heading", icon: "bi-type-h1", hint: "画面・区画の見出し" },
      { type: "text", icon: "bi-text-paragraph", hint: "説明文・注意書き" },
      { type: "field", icon: "bi-input-cursor-text", hint: "新しい入力項目" },
      { type: "table", icon: "bi-table", hint: "新しい一覧" },
      { type: "button", icon: "bi-hand-index", hint: "操作ボタン" },
      { type: "link", icon: "bi-link-45deg", hint: "他画面へのリンク" },
      { type: "message-area", icon: "bi-chat-square-text", hint: "結果・エラーの表示" },
      { type: "image", icon: "bi-image", hint: "画像" },
      { type: "divider", icon: "bi-dash-lg", hint: "区切り線" },
    ],
  },
];
