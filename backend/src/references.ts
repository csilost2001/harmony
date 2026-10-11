/**
 * 参照元 (どこで使われているか) の検索。
 * ID の改名と同じ走査 (renameEntity の previewEntityRename) で、その設計を参照している場所を集め、
 * 参照元の設計ごとにまとめて返す。業務フロー・帳票の参照も含める。
 *
 * 改名・削除の前に影響範囲を知る、設計を読んでいて「これは誰が使っているか」を辿る、ために使う。
 */
import { previewEntityRename, type RenameEntityType } from "./renameEntity.js";
import {
  readProject, renameBusinessFlowRefsInProject, renameReportRefsInProject,
  listBusinessFlowsDetailed, listReportsDetailed,
} from "./projectStorage.js";

/** 存在しない ID (改名先として走査するための、どの設計とも重ならない値) */
const PROBE_ID = "zz-probe-reference-scan";

export type ReferrerKind =
  | "screen" | "processFlow" | "table" | "sequence" | "view" | "viewDefinition" | "pageLayout"
  | "businessFlow" | "report" | "screenFlow" | "layoutComponent" | "genericDefinition";

export interface Referrer {
  kind: ReferrerKind;
  /** 参照元の設計の ID (画面フローは "screen-flow") */
  id: string;
  /** 分かれば参照元の名前 */
  name?: string;
  /** 参照している箇所の数 */
  count: number;
}

export interface ReferenceResult {
  entityType: RenameEntityType;
  id: string;
  exists: boolean;
  referrers: Referrer[];
  total: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function findReferences(entityType: RenameEntityType, id: string, root: string): Promise<ReferenceResult> {
  const preview = await previewEntityRename(entityType, id, PROBE_ID, root);
  const counts = new Map<string, Referrer>();
  const add = (kind: ReferrerKind, rid: string, n = 1, name?: string) => {
    const key = `${kind}:${rid}`;
    const cur = counts.get(key);
    if (cur) cur.count += n; else counts.set(key, { kind, id: rid, count: n, ...(name ? { name } : {}) });
  };

  for (const loc of preview.refUpdates) {
    switch (loc.entityKind) {
      case "project":
        // 設計の一覧表そのもの (/entities/<種別>/n/id) は参照ではない。画面の遷移だけが参照
        if (loc.jsonPointer.includes("/screenTransitions/")) add("screenFlow", "screen-flow");
        break;
      case "screenFlowPositions": case "erLayout": break; // 図の座標。参照ではない
      case "layoutComponents": add("layoutComponent", "layout-components"); break;
      case "genericDefinition": add("genericDefinition", loc.entityId); break;
      case "screen": case "processFlow": case "table": case "sequence": case "view": case "viewDefinition": case "pageLayout":
        // 自分自身の中の参照 (自己参照) は除く
        if (!(loc.entityKind === entityType && loc.entityId === id)) add(loc.entityKind as ReferrerKind, loc.entityId);
        break;
      default: add("genericDefinition", loc.entityId); break;
    }
  }

  // 業務フロー・帳票は、改名の予行 (dryRun) で、参照している設計の ID を得る
  const businessFlowIds: string[] = [];
  const reportIds: string[] = [];
  if (entityType === "screen" || entityType === "processFlow") {
    businessFlowIds.push(...(await renameBusinessFlowRefsInProject(entityType, id, PROBE_ID, root, true)).changed);
  }
  if (entityType === "screen" || entityType === "processFlow" || entityType === "table") {
    reportIds.push(...(await renameReportRefsInProject(entityType, id, PROBE_ID, root, true)).changed);
  }
  for (const f of businessFlowIds) add("businessFlow", f);
  for (const r of reportIds) add("report", r);

  // 名前を補う (一覧に載っているものだけ。なければ ID だけ)
  const names = await referrerNames(root).catch(() => new Map<string, string>());
  const referrers = [...counts.values()].map((r) => ({ ...r, ...(names.get(`${r.kind}:${r.id}`) ? { name: names.get(`${r.kind}:${r.id}`) } : {}) }));
  referrers.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { entityType, id, exists: preview.oldExists, referrers, total: referrers.reduce((s, r) => s + r.count, 0) };
}

async function referrerNames(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const project = await readProject(root);
  const entities = isRecord(project) && isRecord(project.entities) ? project.entities : {};
  const put = (kind: ReferrerKind, list: unknown) => {
    for (const e of Array.isArray(list) ? list : []) {
      if (isRecord(e) && typeof e.id === "string" && typeof e.name === "string") out.set(`${kind}:${e.id}`, e.name);
    }
  };
  put("screen", entities.screens);
  put("table", entities.tables);
  put("processFlow", entities.processFlows);
  put("sequence", entities.sequences);
  put("view", entities.views);
  put("viewDefinition", entities.viewDefinitions);
  put("pageLayout", entities.pageLayouts);
  put("businessFlow", (await listBusinessFlowsDetailed(root)).flows);
  put("report", (await listReportsDetailed(root)).reports);
  return out;
}
