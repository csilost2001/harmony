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
 * 違反の一覧から、要確認に出す違反を選ぶ。
 * - `if` / `then` の副次的な違反 (必須の項目がないと、「then のスキーマに合わない」が重ねて出る) は、元の違反と重複するので除く
 * - **種類 (kind) で決まる oneOf** (工程の 26 種類など): 種類が合わない枝の違反は除く。そのままだと、1 つの工程の必須の項目が 1 つ足りないだけで、
 *   ほかの 25 種類の枝の「必須の項目がありません」が 100 件以上並び、本当の原因が埋もれる。種類がどの枝にも合わないとき (kind の綴り間違い) は、kind の違反を 1 件だけ残す
 */
export function selectAjvErrors<T extends Pick<ErrorObject, "keyword"> & Partial<Pick<ErrorObject, "instancePath" | "schemaPath">>>(errors: readonly T[]): T[] {
  const primary = errors.filter((e) => e.keyword !== "if");
  const base = primary.length > 0 ? primary : [...errors];

  // 種類 (kind) が合わなかった枝: subject (その工程の instancePath) → 枝の番号
  const ONEOF = /^(.*\/oneOf)\/(\d+)\//;
  const failed = new Map<string, Set<string>>(); // `${oneOfPath}@${subject}` → 枝の番号
  const subjects = new Map<string, T>(); // subject → 最初の kind の違反
  for (const e of base) {
    const ip = e.instancePath, sp = e.schemaPath;
    if (!ip || !sp || !/\/kind$/.test(ip) || !(e.keyword === "const" || e.keyword === "pattern")) continue;
    const m = ONEOF.exec(sp);
    if (!m) continue;
    const subject = ip.slice(0, -"/kind".length);
    const key = `${m[1]}@${subject}`;
    (failed.get(key) ?? failed.set(key, new Set()).get(key)!).add(m[2]);
    if (!subjects.has(subject)) subjects.set(subject, e);
  }
  if (failed.size === 0) return base;

  const survivors = base.filter((e) => {
    const ip = e.instancePath ?? "", sp = e.schemaPath ?? "";
    const m = ONEOF.exec(sp);
    if (!m) return true;
    // この違反が、種類の合わなかった枝の中のものなら除く
    for (const [key, idx] of failed) {
      const at = key.indexOf("@");
      if (key.slice(0, at) !== m[1]) continue;
      const subject = key.slice(at + 1);
      if ((ip === subject || ip.startsWith(`${subject}/`)) && idx.has(m[2])) return false;
    }
    return true;
  });
  // 工程ごとに、どの枝にも合わなかったら (種類の綴り間違い)、kind の違反を 1 件だけ残す
  const out = [...survivors];
  for (const [subject, first] of subjects) {
    const hasOther = survivors.some((e) => (e.instancePath ?? "") === subject || (e.instancePath ?? "").startsWith(`${subject}/`));
    if (!hasOther) out.push(first);
  }
  return out;
}
