/**
 * 業務フロー (スイムレーン) の型・検証・図の自動配置・SVG 出力。
 *
 * 原本は座標を持たない。レーンの並びと工程のつながりから、決定的に図を配置する
 * (同じ入力から同じ図)。アプリの編集画面と設計書 (HTML) で同じ関数を使う。
 *
 * 仕様: docs/spec/business-flow.md
 */

export type LaneKind = "person" | "system" | "external";
export type StepKind = "start" | "task" | "decision" | "end";

export interface BusinessLane { id: string; name: string; kind?: LaneKind; roleRef?: string; description?: string }
export interface BusinessNext { to: string; label?: string }
export interface BusinessStep {
  id: string;
  lane: string;
  kind: StepKind;
  name: string;
  description?: string;
  screenRef?: string;
  processFlowRef?: string;
  next?: BusinessNext[];
}
export interface BusinessFlow {
  $schema?: string;
  version: 1;
  id: string;
  name: string;
  description?: string;
  maturity?: "draft" | "provisional" | "committed";
  lanes: BusinessLane[];
  steps: BusinessStep[];
  createdAt?: string;
  updatedAt?: string;
}

export const BUSINESS_STEP_KIND_LABELS: Record<StepKind, string> = { start: "開始", task: "作業", decision: "判断", end: "終了" };
export const BUSINESS_LANE_KIND_LABELS: Record<LaneKind, string> = { person: "人・部門", system: "システム", external: "外部" };

// ── 検証 ───────────────────────────────────────────────────────────────────

export interface BusinessFlowIssue {
  severity: "error" | "warning" | "info";
  code: "duplicate-id" | "unknown-lane" | "dangling-next" | "no-start" | "no-end" | "unreachable" | "dead-end"
    | "end-with-next" | "decision-branches" | "decision-unlabeled" | "unknown-screen" | "unknown-flow" | "unknown-role";
  message: string;
  stepId?: string;
  laneId?: string;
}

export interface BusinessFlowRefs {
  screens?: ReadonlySet<string>;
  flows?: ReadonlySet<string>;
  /** 規約の役割のキー */
  roles?: ReadonlySet<string>;
}

/** 開始工程。kind=start を優先し、無ければ他の工程から入ってこない工程 */
export function startSteps(flow: Pick<BusinessFlow, "steps">): BusinessStep[] {
  const starts = flow.steps.filter((s) => s.kind === "start");
  if (starts.length) return starts;
  const targeted = new Set(flow.steps.flatMap((s) => (s.next ?? []).map((n) => n.to)));
  return flow.steps.filter((s) => !targeted.has(s.id));
}

/** 開始から到達できる工程の ID */
export function reachableSteps(flow: Pick<BusinessFlow, "steps">): Set<string> {
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = startSteps(flow).map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const n of byId.get(id)!.next ?? []) stack.push(n.to);
  }
  return seen;
}

/** 保存は妨げず、要確認として返す (draft-state 方針) */
export function validateBusinessFlow(flow: BusinessFlow, refs: BusinessFlowRefs = {}): BusinessFlowIssue[] {
  const issues: BusinessFlowIssue[] = [];
  const laneIds = new Set<string>();
  for (const l of flow.lanes) {
    if (laneIds.has(l.id)) issues.push({ severity: "error", code: "duplicate-id", laneId: l.id, message: `レーン ID「${l.id}」が重複しています` });
    laneIds.add(l.id);
    if (l.roleRef && refs.roles && !refs.roles.has(l.roleRef)) {
      issues.push({ severity: "warning", code: "unknown-role", laneId: l.id, message: `レーン「${l.name}」の役割「${l.roleRef}」が規約に定義されていません` });
    }
  }
  const stepIds = new Set<string>();
  for (const s of flow.steps) {
    if (stepIds.has(s.id)) issues.push({ severity: "error", code: "duplicate-id", stepId: s.id, message: `工程 ID「${s.id}」が重複しています` });
    stepIds.add(s.id);
  }
  for (const s of flow.steps) {
    const at = `工程「${s.name || s.id}」`;
    if (!laneIds.has(s.lane)) issues.push({ severity: "error", code: "unknown-lane", stepId: s.id, message: `${at}のレーン「${s.lane}」が存在しません` });
    for (const n of s.next ?? []) {
      if (!stepIds.has(n.to)) issues.push({ severity: "error", code: "dangling-next", stepId: s.id, message: `${at}の次の工程「${n.to}」が存在しません` });
    }
    if (s.kind === "end" && (s.next ?? []).length) issues.push({ severity: "warning", code: "end-with-next", stepId: s.id, message: `${at}は終了ですが、次の工程があります` });
    if (s.kind !== "end" && !(s.next ?? []).length) issues.push({ severity: "warning", code: "dead-end", stepId: s.id, message: `${at}に次の工程がありません (終了にするか、次の工程をつないでください)` });
    if (s.kind === "decision") {
      const outs = s.next ?? [];
      if (outs.length < 2) issues.push({ severity: "warning", code: "decision-branches", stepId: s.id, message: `${at}は判断ですが、分岐が ${outs.length} つしかありません` });
      else if (outs.some((n) => !n.label)) issues.push({ severity: "info", code: "decision-unlabeled", stepId: s.id, message: `${at}の分岐に条件が書かれていないものがあります` });
    }
    if (s.screenRef && refs.screens && !refs.screens.has(s.screenRef)) issues.push({ severity: "warning", code: "unknown-screen", stepId: s.id, message: `${at}の画面「${s.screenRef}」が存在しません` });
    if (s.processFlowRef && refs.flows && !refs.flows.has(s.processFlowRef)) issues.push({ severity: "warning", code: "unknown-flow", stepId: s.id, message: `${at}の処理フロー「${s.processFlowRef}」が存在しません` });
  }
  if (flow.steps.length) {
    if (!flow.steps.some((s) => s.kind === "start")) issues.push({ severity: "warning", code: "no-start", message: "開始の工程がありません" });
    if (!flow.steps.some((s) => s.kind === "end")) issues.push({ severity: "warning", code: "no-end", message: "終了の工程がありません" });
    const reach = reachableSteps(flow);
    for (const s of flow.steps) {
      if (!reach.has(s.id)) issues.push({ severity: "warning", code: "unreachable", stepId: s.id, message: `工程「${s.name || s.id}」は開始からたどり着けません` });
    }
  }
  return issues;
}

// ── 図の自動配置 ─────────────────────────────────────────────────────────

export const BF_LAYOUT = {
  laneLabelW: 120,
  padX: 24,
  padY: 14,
  colGap: 64,
  nodeW: 148,
  nodeH: 54,
  rowGap: 14,
  /** 戻る線を回すための余白 */
  loopPad: 18,
} as const;

export interface PlacedStep { step: BusinessStep; col: number; x: number; y: number; w: number; h: number; laneIndex: number }
export interface PlacedLane { lane: BusinessLane; y: number; h: number }
export interface PlacedEdge { from: string; to: string; label?: string; back: boolean; points: Array<[number, number]>; labelAt: [number, number] }
export interface BusinessFlowLayout { width: number; height: number; lanes: PlacedLane[]; steps: PlacedStep[]; edges: PlacedEdge[] }

/** 工程の列 (開始からの最長経路の深さ)。戻る線は深さの計算から除く */
export function assignColumns(flow: Pick<BusinessFlow, "steps">): Map<string, number> {
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  // 深さ優先で戻る線 (祖先への辺) を見つける
  const back = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const n of byId.get(id)?.next ?? []) {
      if (!byId.has(n.to)) continue;
      const st = state.get(n.to) ?? 0;
      if (st === 1) back.add(`${id}>${n.to}`);
      else if (st === 0) dfs(n.to);
    }
    state.set(id, 2);
  };
  const roots = startSteps(flow).map((s) => s.id);
  for (const id of roots) if (!state.has(id)) dfs(id);
  for (const s of flow.steps) if (!state.has(s.id)) dfs(s.id);

  const col = new Map<string, number>();
  const longest = (id: string, seen: Set<string>): number => {
    if (col.has(id)) return col.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let best = 0;
    for (const p of flow.steps) {
      if (!(p.next ?? []).some((n) => n.to === id) || back.has(`${p.id}>${id}`)) continue;
      best = Math.max(best, longest(p.id, seen) + 1);
    }
    seen.delete(id);
    col.set(id, best);
    return best;
  };
  for (const s of flow.steps) longest(s.id, new Set());
  // 開始から到達できない工程 (孤立) は、最後の列のあとへ
  const reach = reachableSteps(flow);
  const maxCol = Math.max(0, ...[...col.entries()].filter(([id]) => reach.has(id)).map(([, c]) => c));
  let tail = maxCol + 1;
  for (const s of flow.steps) if (!reach.has(s.id)) col.set(s.id, tail++);
  return col;
}

export function layoutBusinessFlow(flow: Pick<BusinessFlow, "lanes" | "steps">): BusinessFlowLayout {
  const L = BF_LAYOUT;
  const cols = assignColumns(flow);
  const laneIndex = new Map(flow.lanes.map((l, i) => [l.id, i]));
  // 同じレーン・同じ列に複数あるときは縦に積む
  const stack = new Map<string, number>();
  const slotOf = new Map<string, number>();
  const laneSlots = new Map<number, number>();
  for (const s of flow.steps) {
    const li = laneIndex.get(s.lane) ?? 0;
    const key = `${li}:${cols.get(s.id) ?? 0}`;
    const slot = stack.get(key) ?? 0;
    stack.set(key, slot + 1);
    slotOf.set(s.id, slot);
    laneSlots.set(li, Math.max(laneSlots.get(li) ?? 1, slot + 1));
  }
  const lanes: PlacedLane[] = [];
  let y = 0;
  flow.lanes.forEach((lane, i) => {
    const slots = laneSlots.get(i) ?? 1;
    const h = L.padY * 2 + slots * L.nodeH + (slots - 1) * L.rowGap + L.loopPad;
    lanes.push({ lane, y, h });
    y += h;
  });
  const colCount = Math.max(1, ...[...cols.values()].map((c) => c + 1));
  const width = L.laneLabelW + L.padX * 2 + colCount * L.nodeW + (colCount - 1) * L.colGap;
  const placed: PlacedStep[] = flow.steps.map((s) => {
    const li = laneIndex.get(s.lane) ?? 0;
    const c = cols.get(s.id) ?? 0;
    const lane = lanes[li] ?? { y: 0, h: 0 };
    return {
      step: s, col: c, laneIndex: li, w: L.nodeW, h: L.nodeH,
      x: L.laneLabelW + L.padX + c * (L.nodeW + L.colGap),
      y: lane.y + L.padY + (slotOf.get(s.id) ?? 0) * (L.nodeH + L.rowGap),
    };
  });
  const at = new Map(placed.map((p) => [p.step.id, p]));
  const edges: PlacedEdge[] = [];
  // 折れ線の縦の位置は、同じ列から出る線ごとにずらす (別の工程から出た線どうしが重なって、つながって見えないように)
  const elbowCount = new Map<number, number>();
  for (const p of placed) {
    for (const n of p.step.next ?? []) {
      const q = at.get(n.to);
      if (!q) continue;
      const back = q.col <= p.col;
      let points: Array<[number, number]>;
      let labelAt: [number, number];
      if (!back) {
        const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = q.x, y2 = q.y + q.h / 2;
        const k = y1 === y2 ? 0 : (elbowCount.get(p.col) ?? 0);
        if (y1 !== y2) elbowCount.set(p.col, k + 1);
        const xm = x1 + 14 + (k % 4) * Math.floor((L.colGap - 28) / 4);
        points = y1 === y2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [xm, y1], [xm, y2], [x2, y2]];
        // 分岐の条件は、折れたあとの横線の上に置く (同じ始点から出る分岐どうしが重ならない)
        labelAt = y1 === y2 ? [x1 + 4, y1 - 5] : [xm + 4, y2 - 5];
      } else {
        // 戻る線 / 同じ列の線: 工程の下を回す
        const bottom = Math.max(p.y + p.h, q.y + q.h) + L.loopPad / 2 + 2;
        const x1 = p.x + p.w / 2, x2 = q.x + q.w / 2;
        points = [[x1, p.y + p.h], [x1, bottom], [x2, bottom], [x2, q.y + q.h]];
        labelAt = [Math.min(x1, x2) + 6, bottom - 4];
      }
      edges.push({ from: p.step.id, to: q.step.id, label: n.label, back, points, labelAt });
    }
  }
  return { width, height: Math.max(y, 1), lanes, steps: placed, edges };
}

// ── SVG ──────────────────────────────────────────────────────────────────

const escXml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 文字を幅に合わせて折り返す (全角 = 1、半角 = 0.55 で概算) */
export function wrapLabel(text: string, maxUnits: number, maxLines = 3): string[] {
  const unit = (ch: string) => (/[\u0000-ÿ]/.test(ch) ? 0.55 : 1);
  const lines: string[] = [];
  let cur = "", w = 0;
  for (const ch of [...text]) {
    const u = unit(ch);
    if (w + u > maxUnits && cur) { lines.push(cur); cur = ""; w = 0; }
    cur += ch; w += u;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.$/, "…");
    return kept;
  }
  return lines;
}

export interface BusinessFlowSvgOptions {
  /** 選択中の工程 ID (強調) */
  selectedId?: string;
  /** 工程に data-testid / クリック用の属性を付ける (編集画面用) */
  interactive?: boolean;
  /** 工程に問題があるときの印用 (工程 ID の集合) */
  problemIds?: ReadonlySet<string>;
  /** 画面・処理への参照があるときの印 */
  showRefs?: boolean;
}

/**
 * 図を SVG 文字列にする。色は CSS クラス (bf-*) で指定するので、置く側のスタイルで決まる。
 * 設計書では DESIGN_DOC_CSS、アプリでは businessFlow.css が bf-* を定義する。
 */
export function businessFlowToSvg(flow: Pick<BusinessFlow, "lanes" | "steps" | "name">, opts: BusinessFlowSvgOptions = {}): string {
  const lay = layoutBusinessFlow(flow);
  const L = BF_LAYOUT;
  const parts: string[] = [];
  parts.push(`<svg class="bf-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lay.width} ${lay.height}" width="${lay.width}" height="${lay.height}" role="img" aria-label="${escXml(flow.name)} の業務フロー図">`);
  parts.push(`<defs><marker id="bf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="bf-arrowhead"/></marker></defs>`);
  lay.lanes.forEach((pl, i) => {
    const kind = pl.lane.kind ?? "person";
    parts.push(`<g class="bf-lane bf-lane-${kind}${i % 2 ? " bf-lane-alt" : ""}" data-lane="${escXml(pl.lane.id)}">`
      + `<rect class="bf-lane-bg" x="0" y="${pl.y}" width="${lay.width}" height="${pl.h}"/>`
      + `<rect class="bf-lane-head" x="0" y="${pl.y}" width="${L.laneLabelW}" height="${pl.h}"/>`
      + wrapLabel(pl.lane.name, 7, 4).map((t, k, arr) => `<text class="bf-lane-name" x="${L.laneLabelW / 2}" y="${pl.y + pl.h / 2 + (k - (arr.length - 1) / 2) * 15 + 4}" text-anchor="middle">${escXml(t)}</text>`).join("")
      + `</g>`);
  });
  for (const e of lay.edges) {
    const d = e.points.map(([x, y], k) => `${k ? "L" : "M"}${x},${y}`).join(" ");
    parts.push(`<path class="bf-edge${e.back ? " bf-edge-back" : ""}" d="${d}" marker-end="url(#bf-arrow)" data-from="${escXml(e.from)}" data-to="${escXml(e.to)}"/>`);
    if (e.label) parts.push(`<text class="bf-edge-label" x="${e.labelAt[0]}" y="${e.labelAt[1]}">${escXml(e.label)}</text>`);
  }
  for (const p of lay.steps) {
    const s = p.step;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const cls = ["bf-step", `bf-${s.kind}`, opts.selectedId === s.id ? "bf-selected" : "", opts.problemIds?.has(s.id) ? "bf-problem" : ""].filter(Boolean).join(" ");
    const attrs = opts.interactive ? ` data-testid="bf-step-${escXml(s.id)}" data-step="${escXml(s.id)}" tabindex="0" role="button"` : ` data-step="${escXml(s.id)}"`;
    let shape: string;
    if (s.kind === "decision") shape = `<polygon class="bf-shape" points="${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}"/>`;
    else if (s.kind === "start" || s.kind === "end") shape = `<rect class="bf-shape" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.h / 2}"/>`;
    else shape = `<rect class="bf-shape" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6"/>`;
    const units = s.kind === "decision" ? 6.2 : 8.4;
    const lines = wrapLabel(s.name, units, 3);
    const text = lines.map((t, k) => `<text class="bf-step-name" x="${cx}" y="${cy + (k - (lines.length - 1) / 2) * 14 + 4}" text-anchor="middle">${escXml(t)}</text>`).join("");
    const ref = opts.showRefs && (s.screenRef || s.processFlowRef)
      ? `<g class="bf-refs">${s.screenRef ? `<text class="bf-ref" x="${p.x + p.w - 6}" y="${p.y + 11}" text-anchor="end">画面</text>` : ""}${s.processFlowRef ? `<text class="bf-ref" x="${p.x + p.w - 6}" y="${p.y + p.h - 5}" text-anchor="end">処理</text>` : ""}</g>`
      : "";
    parts.push(`<g class="${cls}"${attrs}><title>${escXml(s.name)}${s.description ? `: ${escXml(s.description)}` : ""}</title>${shape}${text}${ref}</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

// ── 関連の追従・補助 ───────────────────────────────────────────────────

/** 工程 ID を新規に採る (step1, step2, …。既存と重ならない) */
export function nextStepId(flow: Pick<BusinessFlow, "steps">, base = "step"): string {
  const used = new Set(flow.steps.map((s) => s.id));
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function nextLaneId(flow: Pick<BusinessFlow, "lanes">, base = "lane"): string {
  const used = new Set(flow.lanes.map((l) => l.id));
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** 画面 ID / 処理フロー ID の改名を工程の参照に反映する。変えたら true */
export function renameBusinessFlowRefs(flow: BusinessFlow, kind: "screen" | "processFlow", from: string, to: string): boolean {
  let changed = false;
  for (const s of flow.steps) {
    if (kind === "screen" && s.screenRef === from) { s.screenRef = to; changed = true; }
    if (kind === "processFlow" && s.processFlowRef === from) { s.processFlowRef = to; changed = true; }
  }
  return changed;
}

/** 工程を削除し、その工程への「次」も取り除く。削除した工程の次の工程は、直前の工程へつなぎ直す */
export function removeStep(flow: BusinessFlow, stepId: string): BusinessFlow {
  const gone = flow.steps.find((s) => s.id === stepId);
  if (!gone) return flow;
  const successors = (gone.next ?? []).filter((n) => n.to !== stepId);
  const steps = flow.steps.filter((s) => s.id !== stepId).map((s) => {
    if (!(s.next ?? []).some((n) => n.to === stepId)) return s;
    const kept = (s.next ?? []).filter((n) => n.to !== stepId);
    // 直前の工程が 1 本線で削除した工程にだけつながっていたときは、削除した工程の次へつなぎ直す
    const bridge = kept.length === 0 && (s.next ?? []).length === 1 ? successors.map((n) => ({ to: n.to })) : [];
    const next = [...kept, ...bridge];
    return { ...s, next: next.length ? next : undefined };
  });
  return { ...flow, steps };
}
