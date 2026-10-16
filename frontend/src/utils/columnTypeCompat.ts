/**
 * カラム同士の型の相性 (UI 改善提案 第 3 弾 #49)。ER 図でカラムからカラムへ線を引いたとき、型が合わないと知らせる。
 * 同じ仲間 (整数どうし・文字どうしなど) なら、合っているとみなす。長さの違いは、ここでは問わない。
 */
type Family = "integer" | "decimal" | "string" | "datetime" | "boolean" | "binary" | "json" | "other";

export function typeFamily(dataType: string): Family {
  const t = String(dataType).toUpperCase();
  if (/INT|SERIAL/.test(t)) return "integer";
  if (/DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|MONEY/.test(t)) return "decimal";
  if (/CHAR|TEXT|UUID/.test(t)) return "string";
  if (/DATE|TIME/.test(t)) return "datetime";
  if (/BOOL|BIT/.test(t)) return "boolean";
  if (/BLOB|BINARY/.test(t)) return "binary";
  if (/JSON/.test(t)) return "json";
  return "other";
}

/** 型が合わないときの説明 (合っていれば null) */
export function columnTypeMismatch(a: { dataType: string; physicalName: string }, b: { dataType: string; physicalName: string }): string | null {
  const fa = typeFamily(a.dataType);
  const fb = typeFamily(b.dataType);
  if (fa === fb && fa !== "other") return null;
  if (a.dataType.toUpperCase() === b.dataType.toUpperCase()) return null;
  return `型が違います: ${a.physicalName} は ${a.dataType}、${b.physicalName} は ${b.dataType}`;
}
