/**
 * 設計の原本がスキーマに合っていない点を、読み込み時に集める (「要確認」に出す)。
 * 以前は保存のたびに違反を原本の authoring.markers へ書き込んでいたが、機械が出した警告で原本が汚れ、
 * 差分にも混じるため、書き込まず、ここで計算して示す。draft-state: 違反があっても保存は妨げない。
 */
import { readProjectWithUnregistered } from "./registryMerge.js";
import { describeAjvError } from "./ajvMessages.js";
import { listAllTables, listProcessFlows, readScreenEntity, validateEntitySchema } from "./projectStorage.js";

export interface SchemaIssue {
  severity: "warning";
  /** 「テーブル 顧客」のような、設計書の要確認と同じ形の対象名 */
  section: string;
  message: string;
  ref: { kind: "screen" | "table" | "processFlow"; id: string };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function collectSchemaIssues(root: string): Promise<SchemaIssue[]> {
  const out: SchemaIssue[] = [];
  const push = async (kind: SchemaIssue["ref"]["kind"], label: string, id: string, name: string | undefined, data: unknown) => {
    for (const err of await validateEntitySchema(kind, data)) {
      out.push({ severity: "warning", section: `${label} ${name || id}`, message: `スキーマ: ${describeAjvError(err)}`, ref: { kind, id } });
    }
  };

  const project = (await readProjectWithUnregistered(root)).project;
  const screens = isRecord(project) && isRecord(project.entities) && Array.isArray(project.entities.screens) ? project.entities.screens as Array<{ id: string }> : [];
  for (const s of screens) {
    const e = await readScreenEntity(s.id, root).catch(() => null);
    if (isRecord(e)) await push("screen", "画面", s.id, e.name as string | undefined, e);
  }
  for (const t of await listAllTables(root)) {
    if (isRecord(t) && typeof t.id === "string") await push("table", "テーブル", t.id, t.name as string | undefined, t);
  }
  for (const f of await listProcessFlows(root)) {
    if (isRecord(f) && isRecord(f.meta) && typeof f.meta.id === "string") await push("processFlow", "処理フロー", f.meta.id, f.meta.name as string | undefined, f);
  }
  return out;
}
