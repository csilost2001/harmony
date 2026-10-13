/**
 * スキーマの版を上げるときの、設計データ (JSON) の移行の枠組み。
 *
 * 次の版が決まったら、`MIGRATIONS` に「どの版からどの版へ・どの種類の設計に・どう書き換えるか」を足す。
 * 実行は予行 (書かずに、書き換わるファイルと変わる項目を返す) が既定で、apply を付けたときだけ書く。
 * 書き換える前の内容は、保存と同じ世代 (.harmony-backups) に残るので、戻せる。
 *
 * スキーマそのもの (`schemas/v3/*.json`) の変更は設計者の専権 (AGENTS.md)。この枠組みは、設計者が決めた版の変更を
 * 既存データへ反映するための道具で、何を移行するかは決めない。仕様: docs/spec/schema-migration.md
 */
import {
  actionsDir, entityDirOf, readProject, resolveDataRoot, writeJsonFile, writeProject, type TopLevelEntityKind,
} from "./projectStorage.js";
import fs from "node:fs/promises";
import path from "node:path";

/** この backend が書くスキーマの版 (harmony.json の schemaVersion の最新) */
export const LATEST_SCHEMA_VERSION = "v3";

export type MigrationTarget = TopLevelEntityKind | "project";

export interface SchemaMigration {
  /** 一意の名前 (例: `v3-to-v4/table-column-type`) */
  id: string;
  /** どの版のデータに当てるか / 当てたあとの版 */
  from: string;
  to: string;
  description: string;
  /** 対象の種類 (省略時はすべて。`project` は harmony.json) */
  targets?: MigrationTarget[];
  /** データを書き換えた新しい値を返す (渡された値は書き換えない)。変えないなら、同じ値をそのまま返してよい */
  migrate(data: Record<string, unknown>, ctx: { target: MigrationTarget; id: string }): Record<string, unknown>;
}

/** 登録された移行。次の版が決まるまでは空 (移行は不要) */
export const MIGRATIONS: SchemaMigration[] = [];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** from の版から最新の版まで、順にたどる移行の列。たどれない (途中の版が欠けている) ときは例外 */
export function chainFrom(from: string, migrations: readonly SchemaMigration[] = MIGRATIONS, latest = LATEST_SCHEMA_VERSION): SchemaMigration[] {
  const chain: SchemaMigration[] = [];
  let cur = from;
  const seen = new Set<string>();
  while (cur !== latest) {
    if (seen.has(cur)) throw new Error(`移行が循環しています (${cur})`);
    seen.add(cur);
    const next = migrations.filter((m) => m.from === cur);
    if (next.length === 0) throw new Error(`スキーマの版 ${cur} から ${latest} への移行が登録されていません`);
    chain.push(...next);
    cur = next[0].to;
    if (next.some((m) => m.to !== cur)) throw new Error(`版 ${next[0].from} からの移行の行き先が揃っていません`);
  }
  return chain;
}

/** 変わったトップレベルの項目の名前 (予行で、何が変わるかを示す) */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

export interface MigrationFileChange { file: string; target: MigrationTarget; id: string; changedKeys: string[] }
export interface MigrationReport {
  fromVersion: string;
  toVersion: string;
  /** 適用する (した) 移行の id */
  migrations: string[];
  files: MigrationFileChange[];
  applied: boolean;
  /** 読めずに飛ばしたファイル */
  skipped: string[];
}

const KINDS: TopLevelEntityKind[] = ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"];

/** ワークスペースの設計データに、移行を当てる。apply が true のときだけ書く (予行が既定) */
export async function migrateWorkspace(root: string, opts: { apply?: boolean; migrations?: readonly SchemaMigration[]; latest?: string } = {}): Promise<MigrationReport> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const latest = opts.latest ?? LATEST_SCHEMA_VERSION;
  const project = await readProject(root);
  if (!isRecord(project)) throw new Error("harmony.json を読めません");
  const fromVersion = typeof project.schemaVersion === "string" ? project.schemaVersion : latest;
  const chain = chainFrom(fromVersion, migrations, latest);
  const report: MigrationReport = { fromVersion, toVersion: latest, migrations: chain.map((m) => m.id), files: [], applied: false, skipped: [] };
  if (chain.length === 0) return report; // すでに最新

  const run = (data: Record<string, unknown>, target: MigrationTarget, id: string): Record<string, unknown> => {
    let cur = data;
    for (const m of chain) {
      if (m.targets && !m.targets.includes(target)) continue;
      cur = m.migrate(structuredClone(cur), { target, id });
    }
    return cur;
  };

  const writes: Array<{ file: string; abs: string; data: Record<string, unknown> }> = [];
  const dataRoot = await resolveDataRoot(root);
  for (const kind of KINDS) {
    const dirs = kind === "processFlow" ? [actionsDir(dataRoot), entityDirOf(kind, dataRoot)] : [entityDirOf(kind, dataRoot)];
    for (const dir of dirs) {
      let files: string[] = [];
      try { files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".design.json") && !f.startsWith(".")).sort(); } catch { continue; }
      for (const f of files) {
        const abs = path.join(dir, f);
        const rel = path.relative(dataRoot, abs).split(path.sep).join("/");
        let data: unknown;
        try { data = JSON.parse(await fs.readFile(abs, "utf-8")); } catch { report.skipped.push(rel); continue; }
        if (!isRecord(data)) { report.skipped.push(rel); continue; }
        const next = run(data, kind, f.replace(/\.json$/, ""));
        const keys = changedKeys(data, next);
        if (keys.length) {
          report.files.push({ file: rel, target: kind, id: f.replace(/\.json$/, ""), changedKeys: keys });
          writes.push({ file: rel, abs, data: next });
        }
      }
    }
  }
  const projectNext = run(project, "project", "harmony");
  const projectKeys = changedKeys(project, projectNext);
  if (projectKeys.length) report.files.push({ file: "harmony.json", target: "project", id: "harmony", changedKeys: projectKeys });

  if (opts.apply) {
    // 先に各設計を書き、最後に harmony.json (schemaVersion を上げる)。途中で止まっても、版が上がっていないので、もう一度実行できる (移行は冪等にする)
    for (const w of writes) await writeJsonFile(w.abs, w.data);
    await writeProject({ ...projectNext, schemaVersion: latest }, root);
    report.applied = true;
  }
  return report;
}
