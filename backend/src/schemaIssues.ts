/**
 * 設計の原本がスキーマに合っていない点を、読み込み時に集める (「要確認」に出す)。
 * 以前は保存のたびに違反を原本の authoring.markers へ書き込んでいたが、機械が出した警告で原本が汚れ、
 * 差分にも混じるため、書き込まず、ここで計算して示す。draft-state: 違反があっても保存は妨げない。
 */
import { memoizeBySignature } from "./dataSignature.js";
import { scanWorkspaceHealth } from "./workspaceHealth.js";
import { readProjectWithUnregistered } from "./registryMerge.js";
import { describeAjvError } from "./ajvMessages.js";
import path from "node:path";
import { entityDirOf, harmonyFile, listAllTables, listProcessFlows, readScreenEntity, resolveDataRoot, validateEntitySchema } from "./projectStorage.js";
import { createFileMemo } from "./fileMemo.js";
import { readCheckSettings } from "./designCheckSettings.js";

export interface SchemaIssue {
  severity: "error" | "warning" | "info";
  /** 「テーブル 顧客」のような、設計書の要確認と同じ形の対象名 */
  section: string;
  message: string;
  ref?: { kind: "screen" | "table" | "processFlow"; id: string };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** ファイルごとの検査結果 (ファイルの状態が変わらないあいだ使い回す。1 件の保存で、全件を検査し直さない) */
const issueMemo = createFileMemo<SchemaIssue[]>();

async function computeSchemaIssues(root: string): Promise<SchemaIssue[]> {
  const out: SchemaIssue[] = [];
  const dataRoot = await resolveDataRoot(root);
  const issuesOf = async (kind: NonNullable<SchemaIssue["ref"]>["kind"], label: string, id: string, name: string | undefined, data: unknown): Promise<SchemaIssue[]> =>
    (await validateEntitySchema(kind, data)).map((err) => ({ severity: "warning" as const, section: `${label} ${name || id}`, message: `スキーマ: ${describeAjvError(err)}`, ref: { kind, id } }));
  const fileOf = (kind: "screen" | "table" | "processFlow", id: string) => path.join(entityDirOf(kind, dataRoot), `${id}.json`);

  const project = (await readProjectWithUnregistered(root)).project;
  const screens = isRecord(project) && isRecord(project.entities) && Array.isArray(project.entities.screens) ? project.entities.screens as Array<{ id: string }> : [];
  for (const s of screens) {
    // 旧形式の画面は、旧デザイン・画面項目のファイルと、登録簿 (harmony.json の名前) からも組み立てるので、それらの状態も印に入れる
    const file = fileOf("screen", s.id);
    const extras = [path.join(path.dirname(file), `${s.id}.design.json`), path.join(dataRoot, "screen-items", `${s.id}.json`), harmonyFile(root)];
    out.push(...await issueMemo.get(file, async () => {
      const e = await readScreenEntity(s.id, root).catch(() => null);
      return isRecord(e) ? issuesOf("screen", "画面", s.id, e.name as string | undefined, e) : [];
    }, extras));
  }
  for (const t of await listAllTables(root)) {
    if (isRecord(t) && typeof t.id === "string") out.push(...await issueMemo.get(fileOf("table", t.id), () => issuesOf("table", "テーブル", t.id as string, t.name as string | undefined, t)));
  }
  for (const f of await listProcessFlows(root)) {
    if (isRecord(f) && isRecord(f.meta) && typeof f.meta.id === "string") {
      const id = f.meta.id;
      out.push(...await issueMemo.get(fileOf("processFlow", id), () => issuesOf("processFlow", "処理フロー", id, f.meta && isRecord(f.meta) ? f.meta.name as string | undefined : undefined, f)));
    }
  }
  return out;
}

/** データが変わらないあいだは、検査し直さず前の結果を使う (大きなプロジェクトでは、検査に数秒かかる) */
export const collectSchemaIssues: (root: string) => Promise<SchemaIssue[]> = memoizeBySignature(computeSchemaIssues);

/**
 * 設計書・設計の点検 (check_design) の「要確認」に足す、設計の外で検出した点:
 * スキーマ違反 (collectSchemaIssues) + ファイルの健全性 (読めない・大きすぎる・ファイル名と id の食い違い・一覧にあるのにファイルが無い。workspaceHealth)。
 * 保守の案内 (uuid 未保存・一覧に載っていない) は含めない (RPC `workspace.getHealth` で、ダッシュボードの保守ボタンに出す)。
 */
export async function collectExtraIssues(root: string): Promise<SchemaIssue[]> {
  // 保守の案内 (uuid 未保存・一覧に載っていない) は、設計の内容の問題ではないので、設計書の要確認には出さない
  const health = (await scanWorkspaceHealth(root)).filter((i) => !i.maintenance).map(({ maintenance: _m, code: _c, ...rest }) => { void _m; void _c; return rest; });
  // 点検の設定 (design-check.json) の読めない項目・JSON の誤り。読めないまま黙っていると、抑制・独自ルールが効かないことに気づけない
  const settingsProblems = (await readCheckSettings(root).catch(() => ({ problems: [] as string[] }))).problems
    .map((message): SchemaIssue => ({ severity: "warning", section: "読み込み", message }));
  return [...await collectSchemaIssues(root), ...health, ...settingsProblems];
}
