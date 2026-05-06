/**
 * actionFields.ts
 * ActionDefinition.inputs / outputs の `string | StructuredField[]` union を扱うヘルパー。
 *
 * docs/spec/process-flow-variables.md §5 「読み込み時の自動移行」に従い、
 * 旧 string 形式と新 StructuredField[] 形式を UI で共通に扱うための補助関数を提供する。
 *
 * 現行 UI は自由記述 (string) のみ対応のため、表形式は fieldsToText でテキスト化して表示する。
 * Phase 1 時点では StructuredField[] の編集は未サポート (名前のみのテキスト表示)。
 */
import type { ActionFields, StructuredField } from "../types/action";

/** 値が StructuredField[] (新形式) かを判定する型ガード */
export function isStructuredFields(
  v: ActionFields | undefined,
): v is StructuredField[] {
  return Array.isArray(v);
}

/**
 * 入出力フィールドをテキスト (改行区切り) に変換。
 * - string: そのまま返す
 * - StructuredField[]: name を改行区切りで返す (Phase 1 の textarea 表示用)
 * - undefined: 空文字列
 */
export function fieldsToText(v: ActionFields | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return v.map((f) => f.name).join("\n");
}

/**
 * 将来、StructuredField[] を自由記述モードに戻した時の変換用ユーティリティ。
 * v1 では textarea 編集は常に string として保存される (union の string 側)。
 * 旧形式の改行区切りから StructuredField[] に昇格する際に使う予定。
 */
export function textToStructuredFields(text: string): StructuredField[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name, type: "string" as const }));
}
