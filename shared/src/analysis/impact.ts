/**
 * 影響分析。ある設計 (またはテーブルの 1 列) を変える・消すと、何が連鎖して影響を受けるかを、
 * 参照のつながり (graph.ts) を逆にたどって、段ごとに示す。画面 → 処理 → テーブル のような連鎖を、直接の参照だけでなく最後までたどる。
 */
import type { DesignDocInput } from "../designDocument.js";
import { forEachStep, nodeKey } from "./common.js";
import { buildDesignGraph, type DesignGraph, type DesignNode } from "./graph.js";

export interface ImpactHit {
  node: DesignNode;
  /** 何段目か (1 = 直接) */
  depth: number;
  /** どの設計 (1 段手前) を通って影響が及ぶか。1 段目は対象そのもの */
  via: { key: string; name: string; label: string };
}

export interface ImpactResult {
  target: DesignNode | null;
  column?: string;
  levels: Array<{ depth: number; hits: ImpactHit[] }>;
  total: number;
  /** 種類ごとの件数 */
  byKind: Record<string, number>;
}

export interface ImpactOptions {
  /** テーブルの列で絞る (Column.id または物理名)。1 段目を、その列に結び付いた参照だけにする */
  column?: string;
  maxDepth?: number;
}

/** 列を物理名で指しているか: 処理フローの DB アクセス (SQL・対象フィールド) に列名が含まれる */
function flowsMentioningColumn(input: DesignDocInput, tableId: string, physicalName: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`(^|[^A-Za-z0-9_])${physicalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`);
  for (const f of input.flows) {
    for (const a of f.actions) forEachStep(a.steps, (st) => {
      const x = st as Record<string, unknown>;
      if (st.kind === "dbAccess" && x.tableId === tableId && (re.test(String(x.sql ?? "")) || re.test(String(x.fields ?? "")) || re.test(String(x.naturalQuery ?? "")))) out.add(nodeKey("processFlow", f.meta.id));
    });
  }
  return out;
}

export function analyzeImpact(input: DesignDocInput, kind: DesignNode["kind"], id: string, options: ImpactOptions = {}, graph: DesignGraph = buildDesignGraph(input)): ImpactResult {
  const key = nodeKey(kind, id);
  const target = graph.nodes.get(key) ?? null;
  const empty: ImpactResult = { target, ...(options.column ? { column: options.column } : {}), levels: [], total: 0, byKind: {} };
  if (!target) return empty;
  const maxDepth = options.maxDepth ?? 12;

  // 列で絞るときの 1 段目: その列を指す辺だけ
  let columnFilter: ((e: { column?: string; columns?: string[]; from: string }) => boolean) | null = null;
  if (options.column && kind === "table") {
    const t = input.tables.find((x) => x.id === id);
    const col = (t?.columns ?? []).find((c) => c.id === options.column || c.physicalName === options.column);
    const ids = new Set([options.column, col?.id, col?.physicalName].filter((x): x is string => !!x));
    const mentioning = col ? flowsMentioningColumn(input, id, col.physicalName) : new Set<string>();
    columnFilter = (e) => (e.columns ? e.columns.some((c) => ids.has(c)) : e.column ? ids.has(e.column) : mentioning.has(e.from));
  }

  const visited = new Set<string>([key]);
  let frontier: string[] = [key];
  const levels: ImpactResult["levels"] = [];
  const byKind: Record<string, number> = {};
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const hits: ImpactHit[] = [];
    const next: string[] = [];
    for (const k of frontier) {
      for (const e of graph.dependents.get(k) ?? []) {
        if (depth === 1 && columnFilter && !columnFilter(e)) continue;
        if (visited.has(e.from)) continue;
        visited.add(e.from);
        const node = graph.nodes.get(e.from);
        const via = graph.nodes.get(k);
        if (!node || !via) continue;
        hits.push({ node, depth, via: { key: via.key, name: via.name, label: e.label } });
        byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
        next.push(e.from);
      }
    }
    if (hits.length) levels.push({ depth, hits });
    frontier = next;
  }
  return { target, ...(options.column ? { column: options.column } : {}), levels, total: levels.reduce((n, l) => n + l.hits.length, 0), byKind };
}
