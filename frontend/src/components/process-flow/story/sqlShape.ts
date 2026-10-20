/** 検索 (SELECT) の結果の形の推定 (処理フローの「流れ」表示)。仕様: docs/spec/process-flow-story-view.md */

/**
 * 検索 (SELECT) の結果が、1 件を探す形か、一覧になりうる形かを、SQL から推定する。
 * 1 件: LIMIT 1・集計だけ (GROUP BY なし)・主キー (id) の一致。それ以外は一覧 (0 件のときは、null ではなく空の一覧になりうる)。
 * 仕様・規約に決まりがないため、あくまで推定 (サンプルの書き方に合わせた目安)。
 */
export function selectShape(sql: string): "one" | "list" {
  const s = sql.replace(/\s+/g, " ");
  if (/\bLIMIT\s+1\b/i.test(s)) return "one";
  const head = s.match(/\bSELECT\b(.*?)\bFROM\b/i)?.[1] ?? "";
  if (!/\bGROUP BY\b/i.test(s) && /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(head)) return "one";
  if (/\bWHERE\b.*?(?:^|[\s.(])"?id"?\s*=\s*[@:$?]/i.test(s)) return "one";
  return "list";
}
