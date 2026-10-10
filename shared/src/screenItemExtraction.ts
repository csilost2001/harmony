/**
 * screenItemExtraction.ts (#1380 で `@harmony/shared` に集約)
 *
 * 旧エディタ (GrapesJS、廃止済み) のカスタムコンポーネントタイプ → HTML タグ名のマッピング。
 * 旧形式のデザインを持つ画面の読み取り (旧デザインからの自動変換・画面項目の改名) のためだけに残している。
 * 旧エディタで D&D したブロックは `tagName` を持たず `type` で識別されるため、
 * カスタムタイプ名から HTML タグ名を逆引きするための辞書。
 *
 * "checkbox" は旧カスタムブロック型として checkbox コンポーネントが
 * `type` フィールドのみで保存されていた場合の備え。
 *
 * 経緯:
 *   - frontend `src/utils/screenItemExtractor.ts` (#333 周辺) と backend
 *     `src/renameContext.ts` (#335 周辺) に同一マッピングが複製されていた。
 *   - PR #1378 (#1375) で `@harmony/shared` package を新設後、本 #1380 で集約。
 */

/** 旧エディタ (GrapesJS) のカスタムコンポーネントタイプ → HTML タグ名のマッピング。旧形式のデザインの読み取り専用。 */
export const CUSTOM_TYPE_TO_TAG: Record<string, string> = {
  "validation-input": "input",
  "validation-select": "select",
  "validation-textarea": "textarea",
  "checkbox": "input",
};
