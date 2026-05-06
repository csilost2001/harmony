/**
 * validationTraits.ts
 * フォームフィールドコンポーネントにバリデーションルールのトレイトを追加する。
 *
 * 対象要素: <input>, <select>, <textarea>
 * 追加トレイト:
 *   - required         (checkbox)
 *   - minlength        (number)
 *   - maxlength        (number)
 *   - pattern          (text, 正規表現)
 *   - data-min         (number, 数値最小値)
 *   - data-max         (number, 数値最大値)
 *   - data-error-msg   (text, カスタムエラーメッセージ)
 */
import type { Editor } from "grapesjs";

const VALIDATION_TRAITS = [
  {
    type: "checkbox",
    name: "required",
    label: "必須入力",
  },
  {
    type: "number",
    name: "minlength",
    label: "最小文字数",
    placeholder: "例: 8",
  },
  {
    type: "number",
    name: "maxlength",
    label: "最大文字数",
    placeholder: "例: 100",
  },
  {
    type: "text",
    name: "pattern",
    label: "パターン（正規表現）",
    placeholder: "例: [a-zA-Z0-9]+",
  },
  {
    type: "number",
    name: "data-min",
    label: "最小値（数値フィールド）",
    placeholder: "例: 0",
  },
  {
    type: "number",
    name: "data-max",
    label: "最大値（数値フィールド）",
    placeholder: "例: 999",
  },
  {
    type: "text",
    name: "data-error-msg",
    label: "エラーメッセージ",
    placeholder: "例: 入力内容を確認してください",
  },
];

/** input 要素向けデフォルトトレイト */
const INPUT_BASE_TRAITS = [
  { type: "text",   name: "name",        label: "フィールド名" },
  { type: "text",   name: "placeholder", label: "プレースホルダー" },
  {
    type: "select",
    name: "type",
    label: "入力タイプ",
    options: [
      { id: "text",     label: "テキスト" },
      { id: "number",   label: "数値" },
      { id: "email",    label: "メールアドレス" },
      { id: "password", label: "パスワード" },
      { id: "date",     label: "日付" },
      { id: "tel",      label: "電話番号" },
      { id: "url",      label: "URL" },
      { id: "search",   label: "検索" },
    ],
  },
  ...VALIDATION_TRAITS,
];

/** textarea 要素向けデフォルトトレイト */
const TEXTAREA_BASE_TRAITS = [
  { type: "text",   name: "name",        label: "フィールド名" },
  { type: "text",   name: "placeholder", label: "プレースホルダー" },
  { type: "number", name: "rows",        label: "行数" },
  ...VALIDATION_TRAITS,
];

/** select 要素向けデフォルトトレイト */
const SELECT_BASE_TRAITS = [
  { type: "text",     name: "name",     label: "フィールド名" },
  { type: "checkbox", name: "multiple", label: "複数選択" },
  ...VALIDATION_TRAITS.filter((t) => ["required", "data-error-msg"].includes(t.name)),
];

export function registerValidationTraits(editor: Editor): void {
  const dc = editor.DomComponents;

  // ── <input> ──────────────────────────────────────────────────────────────
  dc.addType("validation-input", {
    isComponent: (el) => el.tagName === "INPUT",
    model: {
      defaults: {
        tagName: "input",
        traits: INPUT_BASE_TRAITS,
      },
    },
  });

  // ── <textarea> ────────────────────────────────────────────────────────────
  dc.addType("validation-textarea", {
    isComponent: (el) => el.tagName === "TEXTAREA",
    model: {
      defaults: {
        tagName: "textarea",
        traits: TEXTAREA_BASE_TRAITS,
      },
    },
  });

  // ── <select> ─────────────────────────────────────────────────────────────
  dc.addType("validation-select", {
    isComponent: (el) => el.tagName === "SELECT",
    model: {
      defaults: {
        tagName: "select",
        traits: SELECT_BASE_TRAITS,
      },
    },
  });
}
