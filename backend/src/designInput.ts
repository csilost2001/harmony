/**
 * ワークスペースから設計書の入力 (DesignDocInput) を組み立てる (backend 版)。
 * 設計書ビュー (frontend の loadDesignInput) / CLI (scripts/lib/load-workspace.mjs) と同じ内容を、
 * MCP tool (要確認事項の検査・テスト観点表) から使うために backend の読み込み関数で作る。
 */
import type { DesignDocInput } from "@harmony/shared";
import {
  readScreenEntity, readEntityReadOnly, listEntitiesReadOnly, readConventions,
  readLayoutComponents, listBusinessFlowsDetailed, listReportsDetailed,
} from "./projectStorage.js";
import { memoizeBySignature } from "./dataSignature.js";
import { readProjectWithUnregistered } from "./registryMerge.js";
import fs from "node:fs/promises";
import path from "node:path";
import { summarizeOpenApi, type ExternalSpecSummary } from "@harmony/shared";
import { createFileMemo } from "./fileMemo.js";
import { genericDefinitionsDir, resolveDataRoot } from "./storageCore.js";
import { readCheckSettings } from "./designCheckSettings.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface LoadedDesignInput {
  input: DesignDocInput;
  /** 読めなかった (壊れている・見つからない) ために入力に載らないもの */
  skipped: string[];
  counts: { screens: number; flows: number; tables: number; businessFlows: number; reports: number };
}

async function computeDesignInput(root: string): Promise<LoadedDesignInput> {
  const skipped: string[] = [];
  // 一覧 (harmony.json) に載っていない設計も、設計書・検査に含める (ファイルが原本)
  const raw = (await readProjectWithUnregistered(root)).project;
  const project = isRecord(raw) ? raw : {};
  const entities = isRecord(project.entities) ? project.entities : {};
  const meta = isRecord(project.meta) ? project.meta : {};

  const screenRefs = Array.isArray(entities.screens) ? (entities.screens as Array<{ id: string }>) : [];
  const screens: unknown[] = [];
  for (const s of screenRefs) {
    try {
      const e = (await readEntityReadOnly("screen", s.id, root)) ?? await readScreenEntity(s.id, root); // 読むだけを先に (旧形式の画面だけ、従来の読み出し)
      if (e) screens.push(e); else skipped.push(`画面「${s.id}」`);
    } catch { skipped.push(`画面「${s.id}」`); }
  }

  // 処理フロー・テーブルは、一覧の並び順 (登録簿 + 載っていないファイル) で並べる
  const registered = (list: unknown[], registry: unknown, idOf: (x: unknown) => string | undefined, label: string): unknown[] => {
    if (!Array.isArray(registry)) return list;
    const ids = (registry as Array<{ id: string }>).map((e) => e.id);
    return ids.flatMap((id) => {
      const found = list.find((x) => idOf(x) === id);
      if (!found) skipped.push(`${label}「${id}」`);
      return found ? [found] : [];
    });
  };
  const flows = registered(await listEntitiesReadOnly("processFlow", root), entities.processFlows,
    (x) => (isRecord(x) && isRecord(x.meta) ? (x.meta.id as string | undefined) : undefined), "処理フロー");
  const tables = registered(await listEntitiesReadOnly("table", root), entities.tables,
    (x) => (isRecord(x) ? (x.id as string | undefined) : undefined), "テーブル");

  const conventions = ((await readConventions(root).catch(() => null)) ?? {}) as Record<string, DesignDocInput["messages"] & Record<string, never>>;
  const conv = conventions as unknown as { msg?: DesignDocInput["messages"]; role?: DesignDocInput["roles"]; permission?: DesignDocInput["permissions"]; limit?: DesignDocInput["limits"]; regex?: DesignDocInput["regex"]; db?: DesignDocInput["db"] };
  const layoutComponents = (await readLayoutComponents(root).catch(() => ({ components: [] }))).components;
  const businessFlows = await listBusinessFlowsDetailed(root);
  const reports = await listReportsDetailed(root);
  for (const f of businessFlows.unreadable) skipped.push(`business-flows/${f}`);
  for (const f of reports.unreadable) skipped.push(`reports/${f}`);

  const genericDefinitions = await readGenericDefinitions(root);
  const checkSettings = (await readCheckSettings(root).catch(() => null))?.settings;
  const input: DesignDocInput = {
    project: { id: meta.id as string | undefined, name: (meta.name as string | undefined) ?? "プロジェクト", description: meta.description as string | undefined },
    screens: screens as unknown as DesignDocInput["screens"],
    flows: flows as unknown as DesignDocInput["flows"],
    tables: tables as unknown as DesignDocInput["tables"],
    transitions: (entities.screenTransitions ?? []) as DesignDocInput["transitions"],
    messages: conv.msg ?? {},
    layoutComponents: layoutComponents as unknown as DesignDocInput["layoutComponents"],
    businessFlows: businessFlows.flows as unknown as DesignDocInput["businessFlows"],
    reports: reports.reports as unknown as DesignDocInput["reports"],
    roles: conv.role ?? {},
    permissions: conv.permission ?? {},
    limits: conv.limit ?? {},
    regex: conv.regex ?? {},
    db: conv.db ?? {},
    genericDefinitions,
    ...(checkSettings ? { checkSettings } : {}),
  };
  return { input, skipped, counts: { screens: screens.length, flows: flows.length, tables: tables.length, businessFlows: businessFlows.flows.length, reports: reports.reports.length } };
}

/** データが変わらないあいだは、読み直さず前の結果を使う (設計書・検査・ダッシュボードが同時に求めても 1 回で済む)。結果は書き換えないこと */
export const loadDesignInputFromRoot: (root: string) => Promise<LoadedDesignInput> = memoizeBySignature(computeDesignInput);

/** 汎用定義 (全種類) を、種類と名前つきで読む。読めないものは含めない */
async function readGenericDefinitions(root: string): Promise<NonNullable<DesignDocInput["genericDefinitions"]>> {
  const out: NonNullable<DesignDocInput["genericDefinitions"]> = [];
  let dataRoot: string;
  try { dataRoot = await resolveDataRoot(root); } catch { return out; }
  let kinds: string[];
  try { kinds = (await fs.readdir(path.join(dataRoot, "generic-definitions"), { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort(); } catch { return out; }
  for (const kind of kinds) {
    let files: string[] = [];
    try { files = (await fs.readdir(genericDefinitionsDir(dataRoot, kind))).filter((f) => f.endsWith(".json")).sort(); } catch { continue; }
    for (const f of files) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(genericDefinitionsDir(dataRoot, kind), f), "utf-8"));
        if (isRecord(data)) out.push({ ...data, kind, name: typeof data.name === "string" ? data.name : f.replace(/\.json$/, "") });
      } catch { /* 読めないものは、ファイルの健全性の検査が知らせる */ }
    }
  }
  return out;
}

// ── 外部システムの OpenAPI の定義 ───────────────────────────────────────────

/** 読む定義の大きさの上限 */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
const specMemo = createFileMemo<ExternalSpecSummary>(200);

/** `externalSystems[].openApiSpec` の値から、照合用の要約を作る。URL は取りに行かない。ワークスペースの外のファイルは読まない。JSON だけ */
export async function loadExternalSpec(root: string, source: string): Promise<ExternalSpecSummary> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return { source, skipped: "url", operations: [] };
  const fail = (error: string): ExternalSpecSummary => ({ source, error, operations: [] });
  let dataRoot: string | null = null;
  try { dataRoot = await resolveDataRoot(root); } catch { /* データフォルダが無くても、ワークスペース直下は探せる */ }
  const base = path.resolve(root);
  const candidates = [path.resolve(base, source), ...(dataRoot ? [path.resolve(dataRoot, source)] : [])];
  for (const file of candidates) {
    if (file !== base && !file.startsWith(base + path.sep)) return fail("ワークスペースの外のファイルは読みません");
    try { await fs.access(file); } catch { continue; }
    if (!/\.json$/i.test(file)) return fail("JSON 形式の OpenAPI だけ読めます (YAML は照合していません)");
    return specMemo.get(file, async () => {
      const st = await fs.stat(file);
      if (st.size > MAX_SPEC_BYTES) return fail(`ファイルが大きすぎます (${Math.round(st.size / 1024 / 1024)} MB。${MAX_SPEC_BYTES / 1024 / 1024} MB まで)`);
      try { return summarizeOpenApi(source, JSON.parse(await fs.readFile(file, "utf-8"))); } catch { return fail("JSON として読めません"); }
    });
  }
  return fail("ファイルが見つかりません");
}

/**
 * 設計書の入力 + 外部システムの OpenAPI の要約。要約は、データフォルダの外のファイルも読むので、データの署名には載らない (入力そのものとは別に、毎回 stat で確かめる)。
 * 画面の「設計の分析」・MCP の分析 tool が使う。
 */
export async function loadDesignInputFull(root: string): Promise<LoadedDesignInput> {
  const base = await loadDesignInputFromRoot(root);
  const sources = new Set<string>();
  for (const f of base.input.flows) for (const e of Object.values(f.context?.catalogs?.externalSystems ?? {})) if (e?.openApiSpec?.trim()) sources.add(e.openApiSpec.trim());
  if (!sources.size) return base;
  const externalSpecs: Record<string, ExternalSpecSummary> = {};
  for (const src of sources) externalSpecs[src] = await loadExternalSpec(root, src);
  return { ...base, input: { ...base.input, externalSpecs } };
}
