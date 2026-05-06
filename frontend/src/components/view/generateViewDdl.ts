import type { View } from "../../types/v3";

export function generateViewDdl(view: View): string {
  const lines: string[] = [];
  const physical = view.physicalName || view.id;

  lines.push(view.materialized
    ? `CREATE MATERIALIZED VIEW ${physical} AS`
    : `CREATE OR REPLACE VIEW ${physical} AS`);

  if (view.selectStatement.trim()) {
    lines.push(view.selectStatement);
  } else {
    lines.push("-- SELECT 文を入力してください");
  }

  lines[lines.length - 1] = lines[lines.length - 1].trimEnd().replace(/;+$/, "") + ";";

  if (view.description) {
    const commentTarget = view.materialized ? "MATERIALIZED VIEW" : "VIEW";
    lines.push(`\nCOMMENT ON ${commentTarget} ${physical} IS '${view.description.replace(/'/g, "''")}';`);
  }

  return lines.join("\n");
}
