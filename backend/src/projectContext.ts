/**
 * 設計全体の要約 (designer__get_project_context)。接続した AI が、最初に 1 回呼んで、何がどれだけあるかをつかむ。
 *
 * 種類ごとの一覧 tool を何度も呼ばずに済むよう、設計の名前・件数・規約・未解決のマーカー・次に使う tool を 1 つにまとめる。
 * 中身 (工程・カラムの詳細) は載せない: それぞれの get_* tool で読む。一覧は limit 件まで (既定 60)。
 */
import path from "node:path";
import { walkAllSteps, type DocFlow } from "@harmony/shared";
import { listMarkers } from "@harmony/shared";
import { loadDesignInputFromRoot } from "./designInput.js";
import { readProjectWithUnregistered } from "./registryMerge.js";
import { listMarkerDocs } from "./markerStore.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface ProjectContextOptions {
  /** 種類ごとに載せる設計の数の上限 (既定 60) */
  limit?: number;
}

/** 次に何をすればよいか (AI への案内)。tool 名・資料の名前は、このリポジトリの実物と一致させる (テストで確かめる) */
export const NEXT_STEPS = [
  "設計を読む: designer__get_process_flow / get_screen_layout / get_table など (id は下の designs から)",
  "設計を作る・直す: 処理フローは /create-flow (MCP Prompts)、直したあとは designer__check_design を呼び、error / warning を 0 件にする",
  "資料: harmony://docs/ai-index (やりたいこと → 読む資料・使う tool)、harmony://spec/index (仕様書の索引)、harmony://schema/<種類> (JSON Schema)",
  "未解決のマーカー (人から AI への指示・質問) は、下の markers。designer__find_all_markers で全文を読み、対応したら designer__resolve_marker",
] as const;

export async function buildProjectContext(root: string, opts: ProjectContextOptions = {}): Promise<Record<string, unknown>> {
  const wanted = typeof opts.limit === "number" && Number.isFinite(opts.limit) ? opts.limit : 60;
  const limit = Math.max(1, Math.min(500, Math.floor(wanted)));
  const { input, skipped, counts } = await loadDesignInputFromRoot(root);
  const raw = (await readProjectWithUnregistered(root)).project;
  const project = isRecord(raw) ? raw : {};
  const meta = isRecord(project.meta) ? project.meta : {};

  const cut = <T,>(items: T[]) => ({ total: items.length, shown: Math.min(items.length, limit), items: items.slice(0, limit) });

  // 設計は途中でも保存でき、壊れたものがある (draft-state)。1 件が壊れていても、全体の要約は返す
  const unreadable: string[] = [];
  const flows: Array<Record<string, unknown>> = [];
  for (const f of input.flows as DocFlow[]) {
    const meta = isRecord(f?.meta) ? f.meta : null;
    if (!meta || typeof meta.id !== "string") { unreadable.push("処理フロー (meta.id がない)"); continue; }
    const actions = Array.isArray(f.actions) ? f.actions : [];
    let steps = 0;
    for (const a of actions) {
      try { for (const _ of walkAllSteps(isRecord(a) && Array.isArray(a.steps) ? (a.steps as never) : undefined)) steps++; } catch { /* 壊れた工程は数えない */ }
    }
    flows.push({ id: meta.id, name: meta.name, flowType: meta.flowType, screenId: meta.screenId, maturity: meta.maturity, actions: actions.length, steps });
  }

  // 未解決のマーカー (人から AI への指示・質問)
  const byKind: Record<string, number> = {};
  const open: Array<{ entityType: string; entityId: string; entityName?: string; kind: string; body: string }> = [];
  for (const t of await listMarkerDocs(root)) {
    for (const m of listMarkers(t.doc, { unresolvedOnly: true })) {
      byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
      const body = typeof m.body === "string" ? m.body : "";
      if (open.length < 10) open.push({ entityType: t.entityType, entityId: t.entityId, entityName: t.entityName, kind: m.kind, body: body.length > 120 ? `${body.slice(0, 118)}…` : body });
    }
  }
  const openTotal = Object.values(byKind).reduce((a, b) => a + b, 0);

  const conv = {
    roles: Object.keys(input.roles ?? {}).length,
    permissions: Object.keys(input.permissions ?? {}).length,
    messages: Object.keys(input.messages ?? {}).length,
    limits: Object.keys(input.limits ?? {}).length,
    regex: Object.keys(input.regex ?? {}).length,
    layoutComponents: (input.layoutComponents ?? []).length,
    genericDefinitions: (input.genericDefinitions ?? []).length,
  };

  return {
    // いま作業しているワークスペース。作業先は「最後に開いたワークスペース」で、画面で開き直すと変わる。書く前に確かめるための印
    workspace: { path: path.resolve(root), name: typeof meta.name === "string" && meta.name.trim() ? meta.name : path.basename(path.resolve(root)) },
    project: { id: meta.id ?? input.project.id, name: input.project.name, description: input.project.description, mode: meta.mode, maturity: meta.maturity },
    techStack: project.techStack ?? null,
    counts,
    designs: {
      screens: cut(input.screens.filter((s) => isRecord(s)).map((s) => ({ id: s.id, name: s.name, purpose: s.purpose, path: s.path, maturity: s.maturity, items: Array.isArray(s.items) ? s.items.length : 0 }))),
      flows: cut(flows),
      tables: cut(input.tables.filter((t) => isRecord(t)).map((t) => ({ id: t.id, name: t.name, physicalName: t.physicalName, category: t.category, columns: Array.isArray(t.columns) ? t.columns.length : 0 }))),
      businessFlows: cut((input.businessFlows ?? []).filter((b) => isRecord(b)).map((b) => ({ id: (b as { id?: string }).id, name: (b as { name?: string }).name }))),
      reports: cut((input.reports ?? []).filter((r) => isRecord(r)).map((r) => ({ id: (r as { id?: string }).id, name: (r as { name?: string }).name }))),
    },
    conventions: conv,
    transitions: input.transitions?.length ?? 0,
    markers: { unresolved: openTotal, byKind, first: open },
    ...(skipped.length || unreadable.length ? { unreadable: [...skipped, ...unreadable] } : {}),
    next: NEXT_STEPS,
  };
}
