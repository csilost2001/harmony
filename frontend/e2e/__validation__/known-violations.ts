/**
 * #964 δ — dummy fixture v1 残骸の例外許可リスト。
 *
 * 通常は空オブジェクト (`{}`)。新規違反検出時は即 red にして builder 化で解消する。
 * やむを得ず literal を残す場合のみ本ファイルに追記し、ISSUE で設計者承認を得ること。
 *
 * 形式:
 *   {
 *     "<pattern key>": ["<relative spec path>:<line number>", ...],
 *   }
 */
export const knownViolations: Record<string, string[]> = {};
