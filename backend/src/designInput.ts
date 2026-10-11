/**
 * ワークスペースから設計書の入力 (DesignDocInput) を組み立てる (backend 版)。
 * 設計書ビュー (frontend の loadDesignInput) / CLI (scripts/lib/load-workspace.mjs) と同じ内容を、
 * MCP tool (要確認事項の検査・テスト観点表) から使うために backend の読み込み関数で作る。
 */
import type { DesignDocInput } from "@harmony/shared";
import {
  readScreenEntity, listProcessFlows, listAllTables, readConventions,
  readLayoutComponents, listBusinessFlowsDetailed, listReportsDetailed,
} from "./projectStorage.js";
import { memoizeBySignature } from "./dataSignature.js";
import { readProjectWithUnregistered } from "./registryMerge.js";

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
      const e = await readScreenEntity(s.id, root);
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
  const flows = registered(await listProcessFlows(root), entities.processFlows,
    (x) => (isRecord(x) && isRecord(x.meta) ? (x.meta.id as string | undefined) : undefined), "処理フロー");
  const tables = registered(await listAllTables(root), entities.tables,
    (x) => (isRecord(x) ? (x.id as string | undefined) : undefined), "テーブル");

  const conventions = ((await readConventions(root).catch(() => null)) ?? {}) as Record<string, DesignDocInput["messages"] & Record<string, never>>;
  const conv = conventions as unknown as { msg?: DesignDocInput["messages"]; role?: DesignDocInput["roles"]; permission?: DesignDocInput["permissions"]; limit?: DesignDocInput["limits"]; regex?: DesignDocInput["regex"] };
  const layoutComponents = (await readLayoutComponents(root).catch(() => ({ components: [] }))).components;
  const businessFlows = await listBusinessFlowsDetailed(root);
  const reports = await listReportsDetailed(root);
  for (const f of businessFlows.unreadable) skipped.push(`business-flows/${f}`);
  for (const f of reports.unreadable) skipped.push(`reports/${f}`);

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
  };
  return { input, skipped, counts: { screens: screens.length, flows: flows.length, tables: tables.length, businessFlows: businessFlows.flows.length, reports: reports.reports.length } };
}

/** データが変わらないあいだは、読み直さず前の結果を使う (設計書・検査・ダッシュボードが同時に求めても 1 回で済む)。結果は書き換えないこと */
export const loadDesignInputFromRoot: (root: string) => Promise<LoadedDesignInput> = memoizeBySignature(computeDesignInput);
