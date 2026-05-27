/**
 * screenItemExtraction.ts (#1380 で `@harmony/shared` に集約)
 *
 * GrapesJS カスタムコンポーネントタイプ → HTML タグ名のマッピング。
 * デザイナーで D&D したブロックは `tagName` を持たず `type` で識別されるため、
 * カスタムタイプ名から HTML タグ名を逆引きするための辞書。
 *
 * "checkbox" は GrapesJS カスタムブロック型として checkbox コンポーネントが
 * `type` フィールドのみで保存される場合の備え。
 *
 * 経緯:
 *   - frontend `src/utils/screenItemExtractor.ts` (#333 周辺) と backend
 *     `src/renameContext.ts` (#335 周辺) に同一マッピングが複製されていた。
 *   - PR #1378 (#1375) で `@harmony/shared` package を新設後、本 #1380 で集約。
 */

/** GrapesJS カスタムコンポーネントタイプ → HTML タグ名のマッピング。 */
export const CUSTOM_TYPE_TO_TAG: Record<string, string> = {
  "validation-input": "input",
  "validation-select": "select",
  "validation-textarea": "textarea",
  "checkbox": "input",
};
