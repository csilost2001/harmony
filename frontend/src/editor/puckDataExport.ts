/**
 * Puck Data → 中間 JSON export 関数。
 *
 * Puck サ終 / メンテ停止時の後方移行用。定常運用には使わない。
 * リスク 11.5 対応 (multi-editor-puck.md § 11.5)。
 *
 * 将来用 — 子 6 dogfood で利用候補。現時点では呼び出し元なし。
 *
 * #806 子 3
 */

/**
 * Puck Data を中間 JSON 形式へ export する。
 *
 * 生成された JSON は Puck に非依存な汎用形式として保存でき、
 * Puck から別エディタへ移行する際の起点データとして利用できる。
 *
 * @param puckData - Puck の Data オブジェクト (PuckBackend の payload)
 * @returns 中間 JSON 形式のラッパーオブジェクト
 */
export function exportPuckDataToIntermediate(puckData: unknown): {
  kind: "puck-export";
  version: 1;
  data: unknown;
} {
  return { kind: "puck-export", version: 1, data: puckData };
}
