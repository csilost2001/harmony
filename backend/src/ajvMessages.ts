/**
 * スキーマ検査 (AJV) の違反を、設計者が読める日本語の文にする。
 * 保存時に、違反を「警告のマーカー」として設計に残すときの本文に使う (draft-state: 保存は妨げない)。
 */
import type { ErrorObject } from "ajv";

const last = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

export function describeAjvError(err: Pick<ErrorObject, "keyword" | "message" | "params" | "instancePath">): string {
  const path = err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/";
  const where = path === "/" ? "全体" : `「${path}」`;
  const p = (err.params ?? {}) as Record<string, unknown>;
  switch (err.keyword) {
    case "required": return `${where}に、必須の項目「${String(p.missingProperty ?? "")}」がありません`;
    case "additionalProperties":
    case "unevaluatedProperties": return `${where}に、定義にない項目「${String(p.additionalProperty ?? p.unevaluatedProperty ?? "")}」があります`;
    case "type": return `${where}の型が違います (${String(p.type ?? "")} である必要があります)`;
    case "enum": return `${where}の値が、決められた選択肢にありません (${Array.isArray(p.allowedValues) ? (p.allowedValues as unknown[]).slice(0, 8).join(" / ") : ""})`;
    case "const": return `${where}の値が、決められた値と違います`;
    case "pattern": return `${where}の形式が違います (${String(p.pattern ?? "")})`;
    case "format": return `${where}の形式が違います (${String(p.format ?? "")})`;
    case "minLength": return `${where}が短すぎます (${String(p.limit ?? "")} 文字以上)`;
    case "maxLength": return `${where}が長すぎます (${String(p.limit ?? "")} 文字まで)`;
    case "minimum": return `${where}が小さすぎます (${String(p.limit ?? "")} 以上)`;
    case "maximum": return `${where}が大きすぎます (${String(p.limit ?? "")} 以下)`;
    case "minItems": return `${where}の件数が少なすぎます (${String(p.limit ?? "")} 件以上)`;
    case "maxItems": return `${where}の件数が多すぎます (${String(p.limit ?? "")} 件まで)`;
    case "uniqueItems": return `${where}に、同じ値が重複しています`;
    case "oneOf":
    case "anyOf": return `${where}が、どの形式にも当てはまりません`;
    default: return `${err.message ?? "スキーマに合っていません"} (${last(path) || "全体"})`;
  }
}

/**
 * 違反の一覧から、マーカーにする違反を選ぶ。`if` / `then` の副次的な違反 (必須の項目がないと、
 * 「then のスキーマに合わない」が重ねて出る) は、元の違反と重複するので除く。
 */
export function selectAjvErrors<T extends Pick<ErrorObject, "keyword">>(errors: readonly T[]): T[] {
  const primary = errors.filter((e) => e.keyword !== "if");
  return primary.length > 0 ? primary : [...errors];
}
