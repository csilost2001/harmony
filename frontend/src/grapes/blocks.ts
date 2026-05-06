import type { Editor, BlockProperties } from "grapesjs";

/* ==========================================================================
   ブロックカタログ — 業務システム向け標準部品 (semantic class 版 #793)
   階層:
     1. レイアウト（セクション見出し・行グリッド）
     2. フィールド（1行単位の入力部品）
     3. 検索・一覧部品
     4. 共通パーツ
   ========================================================================== */

const CAT_LAYOUT = "レイアウト";
const CAT_FIELD  = "フィールド";
const CAT_LIST   = "検索・一覧";
const CAT_COMMON = "共通パーツ";

// ---- HTML テンプレートヘルパ ----
// form-field / field-label / field-value は common.css 独自 semantic class
const field = (
  label: string,
  inner: string,
  opts: { full?: boolean; required?: boolean } = {}
) => `
  <div class="form-field${opts.full ? " full-width" : ""}">
    <div class="field-label${opts.required ? " required" : ""}">${label}</div>
    <div class="field-value">${inner}</div>
  </div>`.trim();

// form-row / fcol-* は common.css 独自 semantic class
const row = (cols: 1 | 2 | 3 | 4, inner: string) =>
  `<div class="form-row fcol-${cols}">${inner}</div>`;

// form-control / form-control-sm は Bootstrap 由来 semantic class
const textInput = (ph = "") =>
  `<input type="text" class="form-control form-control-sm" placeholder="${ph}">`;
const numberInput = () =>
  `<input type="number" class="form-control form-control-sm">`;
const dateInput = () =>
  `<input type="date" class="form-control form-control-sm">`;
// form-select / form-select-sm は Bootstrap 由来 semantic class
const selectInput = () => `
  <select class="form-select form-select-sm">
    <option value="">（選択してください）</option>
    <option>選択肢1</option>
    <option>選択肢2</option>
    <option>選択肢3</option>
  </select>`;

// ---- アイコン（Bootstrap Icons） ----
const icon = (name: string) =>
  `<i class="bi bi-${name}" style="font-size:20px"></i>`;

// ---- ブロック定義 ----
export const appBlocks: (BlockProperties & { id: string })[] = [

  // ==========================================================================
  // レイアウト（行コンテナ・グリッド）
  // semantic class: form-section / form-section-title / form-row / fcol-*
  // ==========================================================================
  {
    id: "section-header",
    label: "セクション見出し",
    category: CAT_LAYOUT,
    media: icon("bookmark-fill"),
    content: `
      <div class="form-section">
        <div class="form-section-title">［セクション名］</div>
        <div class="form-section-body"></div>
      </div>`,
  },
  {
    id: "row-1col",
    label: "1カラム行",
    category: CAT_LAYOUT,
    media: icon("square"),
    content: row(1, field("項目名", textInput())),
  },
  {
    id: "row-2col",
    label: "2カラム行",
    category: CAT_LAYOUT,
    media: icon("layout-split"),
    content: row(2, field("項目1", textInput()) + field("項目2", textInput())),
  },
  {
    id: "row-3col",
    label: "3カラム行",
    category: CAT_LAYOUT,
    media: icon("grid-3x2"),
    content: row(
      3,
      field("項目1", textInput()) +
        field("項目2", textInput()) +
        field("項目3", textInput())
    ),
  },
  {
    id: "row-4col",
    label: "4カラム行",
    category: CAT_LAYOUT,
    media: icon("grid"),
    content: row(
      4,
      field("項目1", textInput()) +
        field("項目2", textInput()) +
        field("項目3", textInput()) +
        field("項目4", textInput())
    ),
  },
  {
    id: "grid-1col",
    label: "1カラムグリッド（空）",
    category: CAT_LAYOUT,
    media: icon("square"),
    content: `<div class="form-row fcol-1"></div>`,
  },
  {
    id: "grid-2col",
    label: "2カラムグリッド（空）",
    category: CAT_LAYOUT,
    media: icon("layout-split"),
    content: `<div class="form-row fcol-2"></div>`,
  },
  {
    id: "grid-3col",
    label: "3カラムグリッド（空）",
    category: CAT_LAYOUT,
    media: icon("grid-3x2"),
    content: `<div class="form-row fcol-3"></div>`,
  },
  {
    id: "grid-4col",
    label: "4カラムグリッド（空）",
    category: CAT_LAYOUT,
    media: icon("grid"),
    content: `<div class="form-row fcol-4"></div>`,
  },

  // ==========================================================================
  // フィールド（1行 = form-row fcol-1 に包んで単体配置可能）
  // semantic class: form-control / form-control-sm / form-select / form-select-sm
  //                 form-check / form-check-input / form-row / fcol-*
  //                 form-field / field-label / field-value (common.css)
  // ==========================================================================
  {
    id: "field-text",
    label: "テキスト",
    category: CAT_FIELD,
    media: icon("input-cursor-text"),
    content: row(1, field("テキスト", textInput())),
  },
  {
    id: "field-number",
    label: "数値",
    category: CAT_FIELD,
    media: icon("123"),
    content: row(1, field("数値", numberInput())),
  },
  {
    id: "field-date",
    label: "日付",
    category: CAT_FIELD,
    media: icon("calendar"),
    content: row(1, field("日付", dateInput())),
  },
  {
    id: "field-select",
    label: "セレクト",
    category: CAT_FIELD,
    media: icon("menu-button-wide"),
    content: row(1, field("選択", selectInput())),
  },
  {
    id: "field-radio",
    label: "ラジオ",
    category: CAT_FIELD,
    media: icon("ui-radios"),
    content: row(1, field(
      "選択",
      `<div class="radio-group">
        <label><input type="radio" name="r1"> 選択1</label>
        <label><input type="radio" name="r1"> 選択2</label>
        <label><input type="radio" name="r1"> 選択3</label>
      </div>`
    )),
  },
  {
    id: "field-checkbox",
    label: "チェックボックス",
    category: CAT_FIELD,
    media: icon("ui-checks"),
    content: row(1, field(
      "チェック",
      `<div class="check-group">
        <label><input type="checkbox"> 項目1</label>
        <label><input type="checkbox"> 項目2</label>
        <label><input type="checkbox"> 項目3</label>
      </div>`
    )),
  },
  {
    id: "field-switch",
    label: "スイッチ",
    category: CAT_FIELD,
    media: icon("toggle-on"),
    content: row(1, field(
      "有効",
      `<div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" role="switch">
      </div>`
    )),
  },
  {
    id: "field-textarea",
    label: "テキストエリア",
    category: CAT_FIELD,
    media: icon("textarea-resize"),
    content: row(1, field(
      "備考",
      `<textarea class="form-control form-control-sm" rows="3"></textarea>`,
      { full: true }
    )),
  },

  // ==========================================================================
  // 検索・一覧
  // semantic class: form-control / form-control-sm / form-select / form-select-sm
  //                 btn / btn-primary / btn-secondary / btn-sm
  //                 table / table-striped / table-hover
  //                 badge / pagination / page-item / page-link
  // ==========================================================================
  {
    id: "search-area",
    label: "検索条件エリア",
    category: CAT_LIST,
    media: icon("funnel"),
    content: `
      <div class="search-area">
        <div class="search-fields">
          <div class="search-field">
            <label>コード</label>
            <input type="text" class="form-control form-control-sm" style="width:140px">
          </div>
          <div class="search-field">
            <label>名称</label>
            <input type="text" class="form-control form-control-sm" style="width:200px">
          </div>
          <div class="search-field">
            <label>ステータス</label>
            <select class="form-select form-select-sm" style="width:140px">
              <option value="">全て</option>
              <option>有効</option>
              <option>無効</option>
            </select>
          </div>
        </div>
        <div class="search-buttons">
          <button type="button" class="btn btn-secondary btn-sm"><i class="bi bi-x-circle"></i> クリア</button>
          <button type="button" class="btn btn-primary btn-sm"><i class="bi bi-search"></i> 検索</button>
        </div>
      </div>`,
  },
  {
    id: "data-table",
    label: "データテーブル",
    category: CAT_LIST,
    media: icon("table"),
    content: `
      <div class="data-table-wrap">
        <div class="data-table-toolbar">
          <span>件数: <strong>0</strong></span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm"><i class="bi bi-plus-lg"></i> 新規</button>
          <button type="button" class="btn btn-secondary btn-sm"><i class="bi bi-download"></i> CSV</button>
        </div>
        <table class="table table-striped table-hover">
          <thead>
            <tr>
              <th class="sortable sort-asc">コード</th>
              <th class="sortable">名称</th>
              <th class="sortable">ステータス</th>
              <th class="sortable num">登録日</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>C0001</td><td>サンプル</td>
              <td><span class="badge">有効</span></td>
              <td class="num">2026-04-01</td>
            </tr>
          </tbody>
        </table>
        <div class="paging-area">
          <span class="paging-count">1 - 1 / 1 件</span>
          <span class="spacer"></span>
          <nav><ul class="pagination pagination-sm mb-0">
            <li class="page-item active"><a class="page-link" href="#">1</a></li>
          </ul></nav>
        </div>
      </div>`,
  },
  {
    id: "paging",
    label: "ページング",
    category: CAT_LIST,
    media: icon("three-dots"),
    content: `
      <div class="paging-area">
        <span class="paging-count">1 - 20 / 100 件</span>
        <span class="spacer"></span>
        <nav><ul class="pagination pagination-sm mb-0">
          <li class="page-item"><a class="page-link" href="#">&laquo;</a></li>
          <li class="page-item active"><a class="page-link" href="#">1</a></li>
          <li class="page-item"><a class="page-link" href="#">2</a></li>
          <li class="page-item"><a class="page-link" href="#">3</a></li>
          <li class="page-item"><a class="page-link" href="#">&raquo;</a></li>
        </ul></nav>
      </div>`,
  },

  // ==========================================================================
  // 共通パーツ
  // semantic class: page-header / page-title / breadcrumb-area (common.css)
  //                 btn / btn-primary / btn-secondary / btn-sm / btn-danger
  //                 card / card-body / card-header / card-footer
  // ==========================================================================
  {
    id: "page-header",
    label: "ページヘッダー",
    category: CAT_COMMON,
    media: icon("type-h1"),
    content: `
      <div class="page-header">
        <h1 class="page-title">ページタイトル</h1>
        <nav class="breadcrumb-area">ホーム &gt; 一覧 &gt; 詳細</nav>
      </div>`,
  },
  {
    id: "form-footer",
    label: "フォームフッター",
    category: CAT_COMMON,
    media: icon("layout-text-window-reverse"),
    content: `
      <div class="form-footer" style="position:static;box-shadow:none">
        <button type="button" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i> 削除</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary btn-sm"><i class="bi bi-arrow-left"></i> 戻る</button>
        <button type="reset" class="btn btn-secondary btn-sm"><i class="bi bi-arrow-counterclockwise"></i> リセット</button>
        <button type="submit" class="btn btn-primary btn-sm"><i class="bi bi-check-lg"></i> 登録</button>
      </div>`,
  },
  {
    id: "button-primary",
    label: "ボタン（Primary）",
    category: CAT_COMMON,
    media: icon("square-fill"),
    content: `<button type="button" class="btn btn-primary btn-sm">ボタン</button>`,
  },
];

export function registerBlocks(editor: Editor) {
  const bm = editor.BlockManager;
  appBlocks.forEach(({ id, ...props }) => bm.add(id, props));
}
