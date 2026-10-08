/**
 * 設計書 (基本設計 + 処理設計) の HTML 生成。
 *
 * 原本 (画面 / 処理フロー / テーブル / 規約の JSON) から、日本の設計書の体裁
 * (表紙・一覧・項目定義表・処理記述表・CRUD 図) を HTML で組み立てる。
 * frontend の設計書ビューと、CLI の HTML 出力 (scripts/export-design-doc.mjs) で共通に使う。
 * 出力は一方向 (HTML を編集して原本に戻すことはしない)。
 *
 * 仕様: docs/spec/design-document.md
 */
import { buildOutline, layoutFlow, deriveTestViewpoints, stepText, type FlowStep, type FlowActionLike, type DiagramLayout, type FlowContext } from "./flowStructure.js";
import { walkLayout, collectItemRefs, type LayoutNode, type ScreenLayout } from "./screenLayout.js";
import { deriveAccessMatrix, type AccessPermission, type AccessRole } from "./accessMatrix.js";
import { expandComponentNode, expandLayout, validateLayoutWithComponents, type LayoutComponentDef } from "./layoutComponents.js";

// ── 入力 (原本 JSON の必要部分だけを構造的に受け取る) ─────────────────────

export interface DocScreenItem {
  id: string;
  label?: string;
  type?: unknown;
  direction?: string;
  required?: boolean;
  readonly?: boolean;
  nonVisual?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  presentation?: { kind?: string; viewDefinitionId?: string; columns?: Array<{ id: string; label: string; path: string; type?: unknown }> };
  events?: Array<{ id?: string; handlerFlowId?: string; handlerActionId?: string; description?: string }>;
  binding?: { kind?: string; path?: string; ref?: { tableId?: string; columnId?: string } };
}

export interface DocScreen {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  purpose?: string;
  path?: string;
  auth?: string;
  /** 表示に必要な権限 (すべて必要) */
  permissions?: string[];
  maturity?: string;
  items?: DocScreenItem[];
  layout?: ScreenLayout;
}

export interface DocFlow {
  meta: { id: string; name?: string; description?: string; flowType?: string; screenId?: string; maturity?: string };
  context?: { catalogs?: { events?: Record<string, { description?: string }> } };
  actions: Array<FlowActionLike & {
    id?: string;
    description?: string;
    requiredPermissions?: string[];
    httpRoute?: { method?: string; path?: string };
    inputs?: Array<{ name: string; type?: unknown; required?: boolean; description?: string }>;
    outputs?: Array<{ name: string; type?: unknown; description?: string }>;
  }>;
}

export interface DocTable {
  id: string;
  name?: string;
  physicalName?: string;
  category?: string;
  description?: string;
  columns?: Array<{ id?: string; physicalName: string; name?: string; dataType?: string; length?: number; scale?: number; notNull?: boolean; primaryKey?: boolean; unique?: boolean; autoIncrement?: boolean; defaultValue?: string; comment?: string; description?: string }>;
  indexes?: Array<{ physicalName?: string; columns?: Array<{ columnId: string }>; unique?: boolean }>;
}

export interface DesignDocInput {
  project: { id?: string; name: string; description?: string };
  screens: DocScreen[];
  flows: DocFlow[];
  tables: DocTable[];
  transitions?: Array<{ sourceScreenId: string; targetScreenId: string; label?: string; trigger?: string }>;
  messages?: Record<string, { template?: string; description?: string; params?: string[] }>;
  /** 規約の役割 (@conv.role.*) と権限 (@conv.permission.*)。あれば「権限」の章を出す */
  roles?: Record<string, AccessRole>;
  permissions?: Record<string, AccessPermission>;
  /** プロジェクト独自部品の定義 (画面レイアウトの展開と「独自部品」の章に使う) */
  layoutComponents?: LayoutComponentDef[];
  /** 表紙に出す版 (例: git の短縮 SHA) */
  version?: string;
  /** 作成日時 (ISO)。省略時は呼び出し時刻 */
  generatedAt?: string;
}

export interface TocEntry { id: string; title: string; level: 1 | 2 }

export interface DesignDocResult {
  /** 本文 HTML (<article class="hd-doc"> … </article>) */
  html: string;
  toc: TocEntry[];
  /** 本文用 CSS (.hd-doc 配下に閉じている) */
  css: string;
  issues: DocIssue[];
}

export interface DocIssue { severity: "error" | "warning" | "info"; section: string; message: string }

// ── 小道具 ───────────────────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 説明文: エスケープした上で Markdown の **強調** と `コード` だけを描画する (設計データの説明は Markdown で書かれることがある) */
export function prose(s: unknown): string {
  return esc(s)
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

const anchor = (kind: string, id: string) => `${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

function typeText(t: unknown): string {
  if (typeof t === "string") {
    return ({ string: "文字列", number: "数値", integer: "整数", boolean: "真偽", date: "日付", datetime: "日時", json: "JSON" } as Record<string, string>)[t] ?? t;
  }
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (o.kind === "array") return `${typeText(o.itemType)} の配列`;
    if (o.kind === "tableRow") return `${String(o.tableId)} の行`;
    if (o.kind === "tableList") return `${String(o.tableId)} の一覧`;
    if (o.kind === "domain") return `ドメイン ${String(o.domainKey ?? "")}`;
    if (o.kind === "extension") return String(o.extensionRef ?? o.ref ?? o.name ?? "拡張型");
    return String(o.kind ?? "構造");
  }
  return "";
}

const DIRECTION: Record<string, string> = { in: "入力", out: "表示", both: "入出力" };
const MATURITY: Record<string, string> = { draft: "作成中", provisional: "レビュー中", committed: "確定" };

function table(headers: string[], rows: string[][], cls = ""): string {
  if (rows.length === 0) return `<p class="hd-empty">（なし）</p>`;
  return `<table class="hd-table ${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function infoGrid(pairs: Array<[string, string]>): string {
  return `<dl class="hd-info">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v || "―"}</dd></div>`).join("")}</dl>`;
}

// ── 画面レイアウトの静的描画 ──────────────────────────────────────────────

export function layoutToHtml(layout: ScreenLayout | undefined, items: readonly DocScreenItem[], defs: readonly LayoutComponentDef[] = []): string {
  if (!layout || layout.nodes.length === 0) return `<p class="hd-empty">（レイアウト未作成）</p>`;
  const byId = new Map(items.map((i) => [i.id, i]));
  const field = (n: LayoutNode): string => {
    const it = n.itemRef ? byId.get(n.itemRef) : undefined;
    if (!it) return `<div class="lv-missing">項目未設定 ${esc(n.itemRef ?? "")}</div>`;
    const req = it.required ? `<span class="lv-req">必須</span>` : "";
    const ctl = it.direction === "out"
      ? `<div class="lv-display">${esc(it.label)}</div>`
      : it.options?.length ? `<div class="lv-input">${esc(it.options[0].label)} ▾</div>`
        : it.type === "boolean" ? `<div class="lv-check">☐ ${esc(it.label)}</div>`
          : `<div class="lv-input${it.type === "integer" || it.type === "number" ? " lv-num" : ""}"></div>`;
    return `<div class="lv-field"><div class="lv-label">${esc(it.label ?? it.id)}${req}<code>${esc(it.id)}</code></div>${ctl}</div>`;
  };
  const tbl = (n: LayoutNode): string => {
    const it = n.itemRef ? byId.get(n.itemRef) : undefined;
    const cols = it?.presentation?.columns ?? [];
    const title = n.props?.title ?? it?.label ?? "";
    const body = cols.length
      ? `<table class="lv-table"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody><tr>${cols.map(() => "<td>―</td>").join("")}</tr></tbody></table>`
      : `<div class="lv-table-empty">${it?.presentation?.viewDefinitionId ? `列はビュー定義「${esc(it.presentation.viewDefinitionId)}」` : "列未定義"}</div>`;
    return `<div class="lv-table-wrap">${title ? `<div class="lv-table-title">${esc(title)}<code>${esc(n.itemRef ?? "")}</code></div>` : ""}${body}</div>`;
  };
  const render = (n: LayoutNode): string => {
    const p = n.props ?? {};
    const kids = (n.children ?? []).map(render).join("");
    switch (n.type) {
      case "heading": return `<div class="lv-h lv-h${p.level ?? 2}">${esc(p.text)}</div>`;
      case "text": return `<p class="lv-text lv-tone-${p.tone ?? "normal"}">${esc(p.text)}</p>`;
      case "field": return field(n);
      case "table": return tbl(n);
      case "button": {
        const it = n.itemRef ? byId.get(n.itemRef) : undefined;
        return `<span class="lv-btn lv-btn-${p.variant ?? "secondary"}">${esc(p.label ?? it?.label ?? "ボタン")}</span>`;
      }
      case "link": return `<span class="lv-link">${esc(p.label ?? "リンク")}</span>`;
      case "message-area": return `<div class="lv-message">メッセージ表示領域</div>`;
      case "image": return `<div class="lv-image">画像 ${esc(p.alt ?? "")}</div>`;
      case "divider": return `<hr class="lv-divider">`;
      case "html": return `<div class="lv-html">自由 HTML</div>`;
      case "form":
      case "search-panel":
        return `<div class="lv-box lv-${n.type}">${p.title || n.type === "search-panel" ? `<div class="lv-box-title">${esc(p.title ?? "検索条件")}</div>` : ""}<div class="lv-grid lv-cols-${p.columns ?? 1}">${kids}</div></div>`;
      case "section": return `<div class="lv-box lv-section">${p.title ? `<div class="lv-box-title">${esc(p.title)}</div>` : ""}<div class="lv-stack">${kids}</div></div>`;
      case "columns": return `<div class="lv-columns">${kids}</div>`;
      case "column": return `<div class="lv-stack" style="flex:${p.span ?? 6} 1 0">${kids}</div>`;
      case "tabs": return `<div class="lv-tabs"><div class="lv-tab-strip">${(n.children ?? []).map((t, i) => `<span class="${i === 0 ? "active" : ""}">${esc(t.props?.title ?? `タブ ${i + 1}`)}</span>`).join("")}</div>${n.children?.[0] ? render(n.children[0]) : ""}</div>`;
      case "tab": return `<div class="lv-stack">${kids}</div>`;
      case "component": {
        const def = defs.find((c) => c.id === n.componentRef);
        if (!def) return `<div class="lv-missing">独自部品「${esc(n.componentRef ?? "")}」の定義が見つかりません</div>`;
        return `<div class="lv-component"><div class="lv-component-tag">独自部品 ${esc(def.label)}</div>${expandComponentNode(n, defs).nodes.map((x) => render(x as LayoutNode)).join("")}</div>`;
      }
      case "button-bar": return `<div class="lv-bar lv-align-${p.align ?? "left"}">${kids}</div>`;
      default: return "";
    }
  };
  return `<div class="lv-paper">${layout.nodes.map(render).join("")}</div>`;
}

// ── 処理フロー図 (SVG) ─────────────────────────────────────────────────────

export function diagramToSvg(lay: DiagramLayout, title: string): string {
  const parts: string[] = [];
  for (const f of lay.frames) {
    parts.push(`<g class="fd-frame fd-frame-${f.kind}"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8"/><text x="${f.x + 10}" y="${f.y + 16}" class="fd-frame-label">${esc(f.label)}</text></g>`);
  }
  for (const e of lay.edges) {
    const d = e.points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    const marker = e.arrow ? ` marker-end="url(#fd-arrow${e.tone === "error" ? "-err" : ""})"` : "";
    const label = e.label && e.points.length >= 4 ? `<text x="${e.points[3][0] + 6}" y="${(e.points[2][1] + e.points[3][1]) / 2 + 4}" class="fd-edge-label">${esc(e.label)}</text>` : "";
    parts.push(`<g class="fd-edge fd-edge-${e.tone ?? "normal"}"><path d="${d}"${marker}/>${label}</g>`);
  }
  for (const n of lay.nodes) {
    const cls = `fd-node fd-tone-${n.tone}${n.conditional ? " fd-cond" : ""}`;
    if (n.shape === "diamond") {
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      parts.push(`<g class="${cls}"><polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}"/><text x="${cx}" y="${cy - 3}" text-anchor="middle" class="fd-caption">${esc(n.caption)}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle" class="fd-text">${esc(n.text)}</text></g>`);
    } else if (n.shape === "pill") {
      parts.push(`<g class="${cls}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}"/><text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle" class="fd-text"><tspan class="fd-bold">${esc(n.caption)}</tspan>  ${esc(n.text)}</text></g>`);
    } else {
      parts.push(`<g class="${cls}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6"/><rect x="${n.x}" y="${n.y}" width="4" height="${n.h}" class="fd-stripe"/><text x="${n.x + 12}" y="${n.y + 16}" class="fd-caption">${esc(n.caption)}</text><text x="${n.x + 12}" y="${n.y + 33}" class="fd-text">${esc(n.text)}</text>${n.sub ? `<text x="${n.x + 12}" y="${n.y + 48}" class="fd-sub">${esc(n.sub)}</text>` : ""}</g>`);
    }
  }
  return `<svg class="hd-diagram" viewBox="0 0 ${lay.width} ${lay.height}" width="${lay.width}" height="${lay.height}" role="img" aria-label="${esc(title)}"><defs><marker id="fd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fd-head"/></marker><marker id="fd-arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="fd-head-err"/></marker></defs>${parts.join("")}</svg>`;
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export type CrudLetter = "C" | "R" | "U" | "D";

export interface CrudMatrix {
  tables: Array<{ id: string; name: string }>;
  rows: Array<{ flowId: string; flowName: string; cells: Record<string, CrudLetter[]> }>;
  findings: Array<{ tableId: string; message: string }>;
}

function opLetters(op: string): CrudLetter[] {
  const o = op.toUpperCase();
  if (o.includes("UPSERT") || o.includes("MERGE")) return ["C", "U"];
  if (o.startsWith("SELECT")) return ["R"];
  if (o === "INSERT" || o.includes("INSERT")) return ["C"];
  if (o === "UPDATE" || o.includes("UPDATE") || o.includes("DECREMENT") || o.includes("INCREMENT")) return ["U"];
  if (o === "DELETE" || o.includes("DELETE") || o.includes("CLEAR")) return ["D"];
  return ["R"];
}

/** 処理フローの DB アクセスから CRUD 図を導出する */
export function deriveCrud(flows: readonly DocFlow[], tables: readonly DocTable[]): CrudMatrix {
  const order = ["C", "R", "U", "D"] as const;
  const rows: CrudMatrix["rows"] = [];
  const used = new Set<string>();
  for (const f of flows) {
    const cells: Record<string, Set<CrudLetter>> = {};
    const walk = (steps: readonly FlowStep[]) => {
      for (const s of steps) {
        if (s.kind === "dbAccess" && typeof s.tableId === "string") {
          const set = (cells[s.tableId] ??= new Set());
          for (const l of opLetters(String(s.operation ?? ""))) set.add(l);
          used.add(s.tableId);
        }
        const x = s as Record<string, unknown>;
        walk((x.steps as FlowStep[]) ?? []);
        for (const b of (x.branches as Array<{ steps: FlowStep[] }>) ?? []) walk(b.steps ?? []);
        walk(((x.elseBranch as { steps?: FlowStep[] }) ?? {}).steps ?? []);
        walk((x.onCommit as FlowStep[]) ?? []);
        walk((x.onRollback as FlowStep[]) ?? []);
      }
    };
    for (const a of f.actions) walk(a.steps ?? []);
    rows.push({
      flowId: f.meta.id,
      flowName: f.meta.name ?? f.meta.id,
      cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, order.filter((l) => v.has(l))])),
    });
  }
  const tableList = tables.map((t) => ({ id: t.id, name: t.name ?? t.id }));
  const findings: CrudMatrix["findings"] = [];
  for (const t of tableList) {
    const letters = new Set(rows.flatMap((r) => r.cells[t.id] ?? []));
    if (!used.has(t.id)) findings.push({ tableId: t.id, message: "どの処理フローからも使われていません" });
    else {
      if (!letters.has("C")) findings.push({ tableId: t.id, message: "登録 (C) する処理フローがありません" });
      if (!letters.has("R")) findings.push({ tableId: t.id, message: "参照 (R) する処理フローがありません" });
    }
  }
  return { tables: tableList, rows, findings };
}

// ── 本体 ─────────────────────────────────────────────────────────────────

export function buildDesignDocument(input: DesignDocInput): DesignDocResult {
  const toc: TocEntry[] = [];
  const issues: DocIssue[] = [];
  const out: string[] = [];
  const screenName = new Map(input.screens.map((s) => [s.id, s.name ?? s.id]));
  const tableName = new Map(input.tables.map((t) => [t.id, t.name ?? t.physicalName ?? t.id]));
  const ctx: FlowContext = { tableName: (id) => tableName.get(id), screenName: (id) => screenName.get(id) };
  const pages = input.screens.filter((s) => s.purpose !== "gadget");
  const gadgets = input.screens.filter((s) => s.purpose === "gadget");
  const date = (input.generatedAt ?? new Date().toISOString()).slice(0, 10);
  const sec = (id: string, title: string, level: 1 | 2, body: string, chapter?: string) => {
    toc.push({ id, title, level });
    const tag = level === 1 ? "h2" : "h3";
    out.push(`<section class="hd-section hd-level-${level}" id="${id}"><${tag} class="hd-title">${chapter ? `<span class="hd-chapter">${chapter}</span>` : ""}${esc(title)}</${tag}>${body}</section>`);
  };

  // 表紙
  const counts: Array<[string, number]> = [["画面", pages.length], ["部品画面", gadgets.length], ["処理フロー", input.flows.length], ["テーブル", input.tables.length]];
  toc.push({ id: "cover", title: "表紙", level: 1 });
  out.push(`<section class="hd-cover" id="cover">
    <div class="hd-cover-meta"><span>文書 <b>基本設計書・処理設計書</b></span><span>版 <b>${esc(input.version ?? "-")}</b></span><span>作成日 <b>${esc(date)}</b></span></div>
    <h1 class="hd-cover-title">${esc(input.project.name)}</h1>
    <p class="hd-cover-sub">基本設計書・処理設計書（Harmony 設計データから生成）</p>
    ${input.project.description ? `<p class="hd-cover-desc">${prose(input.project.description)}</p>` : ""}
    <div class="hd-counts">${counts.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>
    <table class="hd-stamps"><tr><th>承認</th><th>審査</th><th>作成</th></tr><tr><td></td><td></td><td></td></tr></table>
    <p class="hd-note">本書は設計データ (JSON) から自動生成した閲覧用の資料です。修正は Harmony 上で行ってください。</p>
  </section>`);

  // 1. 画面一覧
  sec("screens", "画面一覧", 1, table(
    ["No", "画面 ID", "画面名", "種別", "URL", "成熟度"],
    pages.map((s, i) => [String(i + 1), `<a href="#${anchor("screen", s.id)}"><code>${esc(s.id)}</code></a>`, esc(s.name), esc(s.kind), `<code>${esc(s.path)}</code>`, esc(MATURITY[s.maturity ?? ""] ?? s.maturity ?? "")]),
  ), "1");

  // 2. 画面遷移
  const tr = input.transitions ?? [];
  sec("transitions", "画面遷移", 1, table(
    ["No", "遷移元", "遷移先", "契機"],
    tr.map((t, i) => [String(i + 1), esc(screenName.get(t.sourceScreenId) ?? t.sourceScreenId), esc(screenName.get(t.targetScreenId) ?? t.targetScreenId), esc(t.label ?? t.trigger ?? "")]),
  ), "2");

  // 3. 画面設計
  toc.push({ id: "screen-design", title: "画面設計", level: 1 });
  out.push(`<section class="hd-section hd-level-1" id="screen-design"><h2 class="hd-title"><span class="hd-chapter">3</span>画面設計</h2></section>`);
  input.screens.forEach((s, i) => {
    const items = s.items ?? [];
    const relFlows = input.flows.filter((f) => f.meta.screenId === s.id || items.some((it) => (it.events ?? []).some((e) => e.handlerFlowId === f.meta.id)));
    const defs = input.layoutComponents ?? [];
    const screenIdSet = new Set(input.screens.map((x) => x.id));
    const expandedNodes = s.layout ? (expandLayout(s.layout.nodes, defs).nodes as LayoutNode[]) : [];
    const layoutIssues = validateLayoutWithComponents(s.layout, items, defs, screenIdSet);
    for (const li of layoutIssues.filter((x) => x.severity !== "info")) issues.push({ severity: li.severity, section: `画面 ${s.name ?? s.id}`, message: li.message });
    const unplaced = layoutIssues.filter((x) => x.code === "unplaced-item").length;
    if (s.layout && unplaced) issues.push({ severity: "info", section: `画面 ${s.name ?? s.id}`, message: `画面に配置されていない項目が ${unplaced} 件あります` });
    if (!s.layout) issues.push({ severity: "warning", section: `画面 ${s.name ?? s.id}`, message: "画面レイアウト (業務部品) が未作成です" });
    const placed = s.layout ? collectItemRefs(expandedNodes) : new Set<string>();
    const events = items.flatMap((it) => (it.events ?? []).map((e) => [esc(it.label ?? it.id), esc(e.id ?? ""), e.handlerFlowId ? `<a href="#${anchor("flow", e.handlerFlowId)}">${esc(input.flows.find((f) => f.meta.id === e.handlerFlowId)?.meta.name ?? e.handlerFlowId)}</a>${e.handlerActionId ? ` / ${esc(e.handlerActionId)}` : ""}` : "", esc(e.description ?? "")]));
    let partsCount = 0;
    if (s.layout) walkLayout(expandedNodes, () => { partsCount++; });
    sec(anchor("screen", s.id), `${s.name ?? s.id}`, 2, `
      ${infoGrid([["画面 ID", `<code>${esc(s.id)}</code>`], ["種別", esc(s.purpose === "gadget" ? "部品画面" : s.kind ?? "")], ["URL", `<code>${esc(s.path ?? "")}</code>`], ["認証", esc(s.auth ?? "")], ["成熟度", esc(MATURITY[s.maturity ?? ""] ?? s.maturity ?? "")], ["関連処理", relFlows.map((f) => `<a href="#${anchor("flow", f.meta.id)}">${esc(f.meta.name ?? f.meta.id)}</a>`).join("、")]])}
      ${s.description ? `<p class="hd-desc">${prose(s.description)}</p>` : ""}
      <h4 class="hd-sub">画面レイアウト${s.layout ? `<small>部品 ${partsCount}</small>` : ""}</h4>
      ${layoutToHtml(s.layout, items, defs)}
      <h4 class="hd-sub">項目定義<small>${items.length} 件</small></h4>
      ${table(["No", "項目名", "項目 ID", "型", "桁 / 範囲", "必須", "入出力", "書式・選択肢", "説明"], items.map((it, k) => [
        String(k + 1),
        esc(it.label ?? "") + (it.nonVisual ? ` <span class="hd-tag">非表示</span>` : s.layout && !placed.has(it.id) ? ` <span class="hd-tag">未配置</span>` : ""),
        `<code>${esc(it.id)}</code>`,
        esc(typeText(it.type)),
        esc([it.minLength !== undefined || it.maxLength !== undefined ? `${it.minLength ?? ""}〜${it.maxLength ?? ""}桁` : "", it.min !== undefined || it.max !== undefined ? `${it.min ?? ""}〜${it.max ?? ""}` : ""].filter(Boolean).join(" ")),
        it.required ? "○" : "",
        esc(DIRECTION[it.direction ?? ""] ?? it.direction ?? ""),
        esc([it.pattern ?? "", (it.options ?? []).map((o) => o.label).join(" / ")].filter(Boolean).join(" ")),
        prose(it.description ?? ""),
      ]), "hd-items")}
      ${events.length ? `<h4 class="hd-sub">イベント</h4>${table(["項目", "イベント", "処理", "説明"], events)}` : ""}
    `, `3-${i + 1}`);
  });

  // 4. 処理設計
  sec("flows", "処理一覧", 1, table(
    ["No", "処理 ID", "処理名", "種別", "画面", "アクション数"],
    input.flows.map((f, i) => [String(i + 1), `<a href="#${anchor("flow", f.meta.id)}"><code>${esc(f.meta.id)}</code></a>`, esc(f.meta.name), esc(f.meta.flowType), esc(f.meta.screenId ? screenName.get(f.meta.screenId) ?? f.meta.screenId : ""), String(f.actions.length)]),
  ), "4");
  input.flows.forEach((f, i) => {
    const actionsHtml = f.actions.map((a) => {
      const rows = buildOutline(a.steps ?? [], a, ctx);
      const outline = table(["No", "区分", "処理内容", "対象", "条件・備考"], rows.map((r) => [
        `<code>${esc(r.no)}</code>`, esc(r.kind),
        `<span style="padding-left:${r.depth * 14}px">${r.type === "branch-arm" ? "▸ " : ""}${esc(r.text)}</span>`, esc(r.target), esc(r.note),
      ]), "hd-outline");
      const io = [
        ...(a.inputs ?? []).map((p) => ["入力", `<code>${esc(p.name)}</code>`, esc(typeText(p.type)), p.required ? "○" : "", esc(p.description ?? "")]),
        ...(a.outputs ?? []).map((p) => ["出力", `<code>${esc(p.name)}</code>`, esc(typeText(p.type)), "", esc(p.description ?? "")]),
      ];
      return `<div class="hd-action">
        <h4 class="hd-sub">アクション: ${esc(a.name ?? a.id ?? "")}${a.httpRoute ? `<small><code>${esc(a.httpRoute.method)} ${esc(a.httpRoute.path)}</code></small>` : ""}</h4>
        ${a.description ? `<p class="hd-desc">${prose(a.description)}</p>` : ""}
        ${io.length ? table(["区分", "名前", "型", "必須", "説明"], io) : ""}
        <div class="hd-diagram-wrap">${diagramToSvg(layoutFlow(a, ctx), `${f.meta.name ?? f.meta.id} ${a.name ?? ""} の処理フロー図`)}</div>
        ${outline}
        <h4 class="hd-sub">テスト観点<small>分岐と終了から自動導出</small></h4>
        ${table(["No", "区分", "条件", "期待結果", "終了ステップ"], deriveTestViewpoints(a).map((v) => [
          String(v.no), `<span class="hd-sev ${v.category === "正常系" ? "hd-sev-ok" : "hd-sev-error"}">${v.category}</span>`,
          v.conditions.map((c) => esc(c)).join("<br>"), esc(v.expected), `<code>${esc(v.stepNo)}</code>`,
        ]), "hd-tests")}
      </div>`;
    }).join("");
    sec(anchor("flow", f.meta.id), f.meta.name ?? f.meta.id, 2, `
      ${infoGrid([["処理 ID", `<code>${esc(f.meta.id)}</code>`], ["種別", esc(f.meta.flowType ?? "")], ["画面", f.meta.screenId ? `<a href="#${anchor("screen", f.meta.screenId)}">${esc(screenName.get(f.meta.screenId) ?? f.meta.screenId)}</a>` : ""], ["成熟度", esc(MATURITY[f.meta.maturity ?? ""] ?? f.meta.maturity ?? "")]])}
      ${f.meta.description ? `<p class="hd-desc">${prose(f.meta.description)}</p>` : ""}
      ${actionsHtml}
    `, `4-${i + 1}`);
  });

  // 5. テーブル定義
  const crud = deriveCrud(input.flows, input.tables);
  sec("tables", "テーブル一覧", 1, table(
    ["No", "テーブル名", "物理名", "分類", "列数"],
    input.tables.map((t, i) => [String(i + 1), `<a href="#${anchor("table", t.id)}">${esc(t.name)}</a>`, `<code>${esc(t.physicalName)}</code>`, esc(t.category), String(t.columns?.length ?? 0)]),
  ), "5");
  input.tables.forEach((t, i) => {
    const usage = crud.rows.filter((r) => r.cells[t.id]?.length).map((r) => [`<a href="#${anchor("flow", r.flowId)}">${esc(r.flowName)}</a>`, (r.cells[t.id] ?? []).join("")]);
    // 影響範囲: この表の列に結び付いた画面項目 (binding.kind=tableColumn)
    const colLabel = new Map((t.columns ?? []).map((c) => [c.id ?? c.physicalName, `${c.name ?? ""} (${c.physicalName})`]));
    const boundItems = input.screens.flatMap((sc) => (sc.items ?? [])
      .filter((it) => it.binding?.kind === "tableColumn" && it.binding.ref?.tableId === t.id)
      .map((it) => [`<a href="#${anchor("screen", sc.id)}">${esc(sc.name ?? sc.id)}</a>`, `${esc(it.label ?? "")} <code>${esc(it.id)}</code>`, esc(colLabel.get(it.binding?.ref?.columnId ?? "") ?? it.binding?.ref?.columnId ?? "")]));
    const colName = new Map((t.columns ?? []).map((c) => [c.id ?? c.physicalName, c.physicalName]));
    sec(anchor("table", t.id), `${t.name ?? t.id}（${t.physicalName ?? ""}）`, 2, `
      ${t.description ? `<p class="hd-desc">${prose(t.description)}</p>` : ""}
      ${table(["No", "論理名", "物理名", "型", "長さ", "NN", "PK", "UK", "既定値", "説明"], (t.columns ?? []).map((c, k) => [
        String(k + 1), esc(c.name), `<code>${esc(c.physicalName)}</code>`, esc(c.dataType), esc(c.length !== undefined ? `${c.length}${c.scale !== undefined ? `,${c.scale}` : ""}` : ""),
        c.notNull ? "○" : "", c.primaryKey ? "○" : "", c.unique ? "○" : "", `<code>${esc(c.defaultValue ?? "")}</code>`, prose(c.comment ?? c.description ?? ""),
      ]), "hd-columns")}
      ${t.indexes?.length ? `<h4 class="hd-sub">インデックス</h4>${table(["名前", "列", "一意"], t.indexes.map((x) => [`<code>${esc(x.physicalName)}</code>`, esc((x.columns ?? []).map((c) => colName.get(c.columnId) ?? c.columnId).join(", ")), x.unique ? "○" : ""]))}` : ""}
      <h4 class="hd-sub">利用箇所 (CRUD)</h4>
      ${table(["処理フロー", "操作"], usage)}
      <h4 class="hd-sub">列を参照している画面項目<small>テーブル変更時の影響範囲</small></h4>
      ${table(["画面", "画面項目", "列"], boundItems)}
    `, `5-${i + 1}`);
  });

  // 6. CRUD 図
  for (const fnd of crud.findings) issues.push({ severity: "info", section: `CRUD ${tableName.get(fnd.tableId) ?? fnd.tableId}`, message: fnd.message });
  sec("crud", "CRUD 図", 1, `
    <div class="hd-scroll"><table class="hd-table hd-crud"><thead><tr><th>処理フロー ＼ テーブル</th>${crud.tables.map((t) => `<th>${esc(t.name)}</th>`).join("")}</tr></thead><tbody>
    ${crud.rows.map((r) => `<tr><th><a href="#${anchor("flow", r.flowId)}">${esc(r.flowName)}</a></th>${crud.tables.map((t) => `<td class="hd-crud-cell">${(r.cells[t.id] ?? []).map((l) => `<span class="hd-crud-${l}">${l}</span>`).join("")}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${crud.findings.length ? `<h4 class="hd-sub">所見 (自動検出)</h4><ul class="hd-findings">${crud.findings.map((f) => `<li><b>${esc(tableName.get(f.tableId) ?? f.tableId)}</b>: ${esc(f.message)}</li>`).join("")}</ul>` : ""}
    <p class="hd-note">処理フローの DB アクセスから自動導出。UPSERT は C+U、在庫減算等の更新系独自操作は U として扱う。</p>
  `, "6");

  // 7. バッチ・定期処理一覧
  const batches = input.flows.filter((f) => f.meta.flowType === "batch" || f.meta.flowType === "scheduled");
  sec("batches", "バッチ・定期処理一覧", 1, table(
    ["No", "処理", "種別", "起動", "説明"],
    batches.flatMap((f) => f.actions.map((a) => [f, a] as const)).map(([f, a], i) => [
      String(i + 1), `<a href="#${anchor("flow", f.meta.id)}">${esc(f.meta.name ?? f.meta.id)}</a> / ${esc(a.name ?? "")}`,
      f.meta.flowType === "scheduled" ? "定期" : "バッチ", esc(a.trigger ?? ""), esc((a.description ?? f.meta.description ?? "").slice(0, 160)),
    ]),
  ), "7");

  // 8. 外部インタフェース一覧 / 9. イベント一覧 (処理フローのステップから導出)
  const ext: string[][] = [];
  const pub = new Map<string, Set<string>>();
  const subs = new Map<string, Set<string>>();
  for (const f of input.flows) {
    const visit = (steps: readonly FlowStep[]) => steps.forEach((st) => {
      const x = st as Record<string, unknown>;
      if (st.kind === "externalSystem") {
        const http = (x.httpCall ?? {}) as { method?: string; url?: string; path?: string };
        ext.push([`<a href="#${anchor("flow", f.meta.id)}">${esc(f.meta.name ?? f.meta.id)}</a>`, `<code>${esc(String(x.systemRef ?? ""))}</code>`, esc([http.method, http.url ?? http.path].filter(Boolean).join(" ")), esc(stepText(st))]);
      }
      const topic = String(x.topic ?? x.eventRef ?? x.event ?? "");
      if (st.kind === "eventPublish" && topic) (pub.get(topic) ?? pub.set(topic, new Set()).get(topic)!).add(f.meta.id);
      if (st.kind === "eventSubscribe" && topic) (subs.get(topic) ?? subs.set(topic, new Set()).get(topic)!).add(f.meta.id);
      visit((x.steps as FlowStep[]) ?? []);
      for (const b of (x.branches as Array<{ steps: FlowStep[] }>) ?? []) visit(b.steps ?? []);
      visit(((x.elseBranch as { steps?: FlowStep[] }) ?? {}).steps ?? []);
      visit((x.onCommit as FlowStep[]) ?? []);
      visit((x.onRollback as FlowStep[]) ?? []);
    });
    for (const a of f.actions) visit(a.steps ?? []);
  }
  sec("interfaces", "外部インタフェース一覧", 1, table(["処理", "外部システム", "呼び出し", "内容"], ext), "8");
  const eventDesc = new Map<string, string>();
  for (const f of input.flows) for (const [k, v] of Object.entries(f.context?.catalogs?.events ?? {})) if (v?.description) eventDesc.set(k, v.description);
  const flowLink = (id: string) => `<a href="#${anchor("flow", id)}">${esc(input.flows.find((f) => f.meta.id === id)?.meta.name ?? id)}</a>`;
  const topics = [...new Set([...pub.keys(), ...subs.keys(), ...eventDesc.keys()])].sort();
  sec("events", "イベント一覧", 1, table(["イベント", "発行する処理", "購読する処理", "説明"], topics.map((t) => [
    `<code>${esc(t)}</code>`, [...(pub.get(t) ?? [])].map(flowLink).join("、"), [...(subs.get(t) ?? [])].map(flowLink).join("、"), esc(eventDesc.get(t) ?? ""),
  ])), "9");
  for (const t of topics) {
    if (!pub.has(t) && eventDesc.has(t)) issues.push({ severity: "info", section: `イベント ${t}`, message: "カタログに定義されていますが、発行する処理フローがありません" });
  }

  // 10. 独自部品 (定義があるときだけ。以降の章番号は 1 つ繰り下がる)
  const compDefs = input.layoutComponents ?? [];
  let chap = 10;
  if (compDefs.length) {
    toc.push({ id: "components", title: "独自部品", level: 1 });
    out.push(`<section class="hd-section hd-level-1" id="components"><h2 class="hd-title"><span class="hd-chapter">${chap}</span>独自部品</h2>
      <p class="hd-desc">このプロジェクト専用の再利用部品です。画面では参照部品として置き、差し込み口に値を入れて使います。</p></section>`);
    const usedBy = (id: string) => input.screens.filter((sc) => {
      let hit = false;
      walkLayout(sc.layout?.nodes ?? [], (n) => { if (n.type === "component" && n.componentRef === id) hit = true; });
      return hit;
    });
    const KIND: Record<string, string> = { text: "文言", item: "画面項目", screen: "遷移先画面" };
    compDefs.forEach((c) => {
      const previewItems = c.params.filter((q) => q.kind === "item").map((q) => ({ id: q.id, label: q.label, type: "string", direction: "in" }) as DocScreenItem);
      const previewArgs = Object.fromEntries(c.params.filter((q) => q.kind === "item").map((q) => [q.id, q.id]));
      const preview = layoutToHtml({ version: 1, nodes: [{ id: "preview", type: "component", componentRef: c.id, args: previewArgs }] }, previewItems, compDefs);
      const users = usedBy(c.id);
      sec(anchor("component", c.id), `${c.label}（${c.id}）`, 2, `
        ${c.description ? `<p class="hd-desc">${prose(c.description)}</p>` : ""}
        <h4 class="hd-sub">差し込み口<small>${c.params.length} 件</small></h4>
        ${table(["差し込み口", "ID", "種類", "既定値"], c.params.map((q) => [esc(q.label), `<code>${esc(q.id)}</code>`, KIND[q.kind] ?? q.kind, esc(q.default ?? "")]))}
        <h4 class="hd-sub">見た目</h4>
        ${preview}
        <h4 class="hd-sub">使っている画面<small>${users.length} 画面</small></h4>
        ${users.length ? `<p>${users.map((sc) => `<a href="#${anchor("screen", sc.id)}">${esc(sc.name ?? sc.id)}</a>`).join("、")}</p>` : `<p class="hd-empty">どの画面でも使われていません。</p>`}`);
      if (!users.length) issues.push({ severity: "info", section: `独自部品 ${c.label}`, message: "どの画面でも使われていません" });
    });
    chap = 11;
  }

  // 権限 (役割・権限の定義、または画面・処理の権限指定があるときだけ)
  const roles = input.roles ?? {};
  const permDefs = input.permissions ?? {};
  const screenSubjects = pages.filter((s) => (s.permissions ?? []).length).map((s) => ({ id: s.id, name: s.name ?? s.id, permissions: s.permissions ?? [] }));
  const actionSubjects = input.flows.flatMap((f) => f.actions.filter((a) => (a.requiredPermissions ?? []).length).map((a) => ({ id: `${f.meta.id}/${a.id ?? ""}`, flowId: f.meta.id, name: `${f.meta.name ?? f.meta.id}${a.id ? ` / ${a.id}` : ""}`, permissions: a.requiredPermissions ?? [] })));
  if (Object.keys(roles).length || Object.keys(permDefs).length || screenSubjects.length || actionSubjects.length) {
    const am = deriveAccessMatrix({ roles, permissions: permDefs, screens: screenSubjects, flows: actionSubjects });
    for (const x of am.issues) issues.push({ severity: x.severity, section: x.target, message: x.message });
    const roleLabel = (id: string) => esc(roles[id]?.name ?? id);
    const mark = (ok: boolean) => (ok ? `<span class="hd-ok">○</span>` : "");
    const matrix = (rows: typeof am.screens, linkOf: (id: string) => string, head: string) => rows.length ? `<div class="hd-scroll"><table class="hd-table hd-crud"><thead><tr><th>${head}</th><th>必要な権限</th>${am.roleIds.map((r) => `<th>${roleLabel(r)}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr><th>${linkOf(r.id)}</th><td>${r.permissions.map((p) => `<code>${esc(p)}</code>`).join("、")}</td>${am.roleIds.map((rid) => `<td class="hd-crud-cell">${mark(r.roles.includes(rid))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="hd-empty">権限を指定した項目はありません。</p>`;
    const openScreens = pages.length - screenSubjects.length;
    toc.push({ id: "access", title: "権限", level: 1 });
    out.push(`<section class="hd-section hd-level-1" id="access"><h2 class="hd-title"><span class="hd-chapter">${chap}</span>権限</h2>
      <p class="hd-desc">規約の役割・権限と、画面の「必要な権限」・処理の「必要な権限」から導いた一覧です。必要な権限は<b>すべて</b>持つ役割だけが使えます。</p>
      <h4 class="hd-sub">役割<small>${am.roleIds.length} 件</small></h4>
      ${table(["役割", "名称", "継承", "使える権限 (継承を含む)", "説明"], am.roleIds.map((r) => [`<code>${esc(r)}</code>`, esc(roles[r].name ?? ""), (roles[r].inherits ?? []).map((x) => `<code>${esc(x)}</code>`).join("、"), am.effective[r].map((p) => `<code>${esc(p)}</code>`).join("、"), esc(roles[r].description ?? "")]))}
      <h4 class="hd-sub">権限<small>${Object.keys(permDefs).length} 件</small></h4>
      ${table(["権限", "対象", "操作", "範囲", "付与する役割", "説明"], Object.entries(permDefs).map(([k, p]) => [`<code>${esc(k)}</code>`, esc(p.resource ?? ""), esc(p.action ?? ""), esc(p.scope ?? ""), am.roleIds.filter((r) => am.effective[r].includes(k)).map(roleLabel).join("、"), esc(p.description ?? "")]))}
      <h4 class="hd-sub">画面 × 役割<small>${screenSubjects.length} 画面</small></h4>
      ${matrix(am.screens, (id) => `<a href="#${anchor("screen", id)}">${esc(screenName.get(id) ?? id)}</a>`, "画面")}
      ${openScreens > 0 ? `<p class="hd-note">権限を指定していない画面 ${openScreens} 件は、誰でも開けます (認証の要否は各画面の「認証」)。</p>` : ""}
      <h4 class="hd-sub">処理 × 役割<small>${actionSubjects.length} 件</small></h4>
      ${matrix(am.flows, (id) => { const a = actionSubjects.find((x) => x.id === id); return a ? `<a href="#${anchor("flow", a.flowId)}">${esc(a.name)}</a>` : esc(id); }, "処理")}
      <p class="hd-note">権限を指定していない処理は省略しています (誰でも呼び出せる扱い)。</p></section>`);
    chap += 1;
  }

  // メッセージ一覧
  const msgs = Object.entries(input.messages ?? {});
  sec("messages", "メッセージ一覧", 1, table(
    ["No", "メッセージ ID", "文面", "説明"],
    msgs.map(([k, m], i) => [String(i + 1), `<code>@conv.msg.${esc(k)}</code>`, esc(m.template ?? ""), esc(m.description ?? "")]),
  ), String(chap));

  // 要確認事項
  const sevLabel = { error: "エラー", warning: "警告", info: "情報" } as const;
  sec("issues", "要確認事項", 1, issues.length
    ? table(["区分", "対象", "内容"], issues.map((x) => [`<span class="hd-sev hd-sev-${x.severity}">${sevLabel[x.severity]}</span>`, esc(x.section), esc(x.message)]))
    : `<p class="hd-empty">要確認事項はありません。</p>`, String(chap + 1));

  return { html: `<article class="hd-doc">${out.join("\n")}</article>`, toc, css: DESIGN_DOC_CSS, issues };
}

/** 単体の HTML ファイル (CSS 同梱、目次付き) にする */
export function renderStandaloneDesignDoc(input: DesignDocInput): string {
  const doc = buildDesignDocument(input);
  const nav = doc.toc.map((t) => `<a class="hd-toc-${t.level}" href="#${t.id}">${esc(t.title)}</a>`).join("");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.project.name)} 設計書</title>
<style>
body{margin:0;font-family:"BIZ UDPGothic","Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;background:#eef0f3;color:#1d2433}
.hd-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.hd-nav{position:sticky;top:0;height:100vh;overflow:auto;background:#fff;border-right:1px solid #d6dbe3;padding:16px 10px;font-size:13px}
.hd-nav a{display:block;padding:3px 8px;border-radius:4px;color:#2b3446;text-decoration:none}
.hd-nav a:hover{background:#eef2fb}
.hd-toc-1{font-weight:700;margin-top:6px}
.hd-toc-2{padding-left:20px!important;font-size:12.5px;color:#4d576a!important}
main{padding:24px;min-width:0}
@media (max-width:900px){.hd-shell{grid-template-columns:1fr}.hd-nav{position:static;height:auto}}
@media print{.hd-nav{display:none}.hd-shell{display:block}main{padding:0}body{background:#fff}}
${doc.css}
</style></head>
<body><div class="hd-shell"><nav class="hd-nav" aria-label="目次">${nav}</nav><main>${doc.html}</main></div></body></html>`;
}

/** 設計書本文の CSS。.hd-doc 配下に閉じる (アプリ内表示と単体 HTML で共通)。紙面は明色固定 */
export const DESIGN_DOC_CSS = `
.hd-doc{--d-ink:#1d2433;--d-muted:#5d677a;--d-line:#d3d9e2;--d-fill:#f3f5f8;--d-accent:#2c56c9;--d-err:#c23b3b;--d-ok:#24804f;color-scheme:light;max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:18px;color:var(--d-ink);font-size:13.5px;line-height:1.7}
.hd-doc a{color:var(--d-accent)}
.hd-doc code{font-family:ui-monospace,"SFMono-Regular",Menlo,monospace;font-size:.88em;background:var(--d-fill);padding:0 4px;border-radius:3px;overflow-wrap:anywhere}
.hd-cover,.hd-section{background:#fff;border:1px solid var(--d-line);padding:28px 32px;display:flex;flex-direction:column;gap:12px;min-width:0}
.hd-cover{border-top:6px solid var(--d-ink)}
.hd-cover-meta{display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;color:var(--d-muted)}
.hd-cover-meta b{color:var(--d-ink);font-weight:600}
.hd-cover-title{margin:8px 0 0;font-size:2rem;line-height:1.3}
.hd-cover-sub{margin:0;font-size:1.05rem}
.hd-cover-desc{margin:0;color:var(--d-muted);max-width:70ch}
.hd-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--d-line);max-width:560px}
.hd-counts div{display:flex;flex-direction:column;align-items:center;padding:8px}
.hd-counts div+div{border-left:1px solid var(--d-line)}
.hd-counts b{font-size:1.4rem;font-variant-numeric:tabular-nums}
.hd-counts span{font-size:11.5px;color:var(--d-muted)}
.hd-stamps{border-collapse:collapse;align-self:flex-end}
.hd-stamps th,.hd-stamps td{border:1px solid var(--d-ink);width:72px;text-align:center;font-size:11px;font-weight:400;letter-spacing:.2em}
.hd-stamps td{height:62px}
.hd-note{margin:0;font-size:11.5px;color:var(--d-muted)}
.hd-title{margin:0;font-size:1.3rem;border-bottom:2px solid var(--d-ink);padding-bottom:6px;display:flex;gap:10px;align-items:baseline}
.hd-level-2 .hd-title{font-size:1.1rem;border-bottom-width:1px}
.hd-level-1:not(:has(> :nth-child(2))){padding-bottom:14px}
.hd-chapter{font-family:ui-monospace,Menlo,monospace;color:var(--d-accent);font-size:.85em}
.hd-sub{margin:10px 0 0;font-size:.98rem;display:flex;gap:8px;align-items:baseline}
.hd-sub small{font-weight:400;color:var(--d-muted);font-size:.8rem}
.hd-desc{margin:0;max-width:85ch}
.hd-empty{margin:0;color:var(--d-muted)}
.hd-info{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border:1px solid var(--d-line)}
.hd-info div{display:grid;grid-template-columns:76px minmax(0,1fr);border-bottom:1px solid var(--d-line)}
.hd-info dt{background:var(--d-fill);padding:4px 8px;font-size:12px;color:var(--d-muted)}
.hd-info dd{margin:0;padding:4px 8px;min-width:0;overflow-wrap:anywhere}
.hd-table{width:100%;border-collapse:collapse;font-size:12.5px}
.hd-table th{background:var(--d-fill);text-align:left;font-weight:600;padding:5px 8px;border:1px solid var(--d-line);white-space:nowrap}
.hd-table td{padding:5px 8px;border:1px solid var(--d-line);vertical-align:top;overflow-wrap:break-word}
.hd-tag{display:inline-block;font-size:10.5px;padding:0 5px;border-radius:3px;background:#fff1d6;color:#8a5a00}
.hd-scroll{overflow-x:auto}
.hd-crud th,.hd-crud td{text-align:center}
.hd-crud tbody th{text-align:left;white-space:nowrap}
.hd-crud-cell span{font-family:ui-monospace,Menlo,monospace;font-weight:700;margin:0 1px}
.hd-ok{font-weight:700;color:var(--d-accent)}
.hd-crud-C{color:var(--d-ok)}.hd-crud-R{color:var(--d-accent)}.hd-crud-U{color:#a8650b}.hd-crud-D{color:var(--d-err)}
.hd-findings{margin:0;padding-left:1.2em}
.hd-sev{font-size:11px;font-weight:700;padding:0 6px;border-radius:3px;white-space:nowrap}
.hd-sev-error{background:#fbe3e3;color:var(--d-err)}.hd-sev-ok{background:#e5f4ea;color:var(--d-ok)}.hd-sev-warning{background:#fff1d6;color:#8a5a00}.hd-sev-info{background:var(--d-fill);color:var(--d-muted)}
.hd-action{display:flex;flex-direction:column;gap:10px;padding-top:6px;border-top:1px dashed var(--d-line)}
.hd-diagram-wrap{overflow-x:auto;border:1px solid var(--d-line);background:#fafbfc;padding:8px}
.hd-diagram{display:block;margin:0 auto;max-width:100%;height:auto;font-family:inherit}
.fd-node rect,.fd-node polygon{fill:#fff;stroke:#b9c1cd;stroke-width:1.2}
.fd-stripe{fill:#9aa3b2!important;stroke:none!important}
.fd-tone-db rect:first-of-type{stroke:#4a72d1}.fd-tone-db .fd-stripe{fill:#2c56c9!important}
.fd-tone-decision polygon{fill:#fdf1df;stroke:#c98213}
.fd-tone-error rect{fill:#fbe7e7;stroke:var(--d-err)}.fd-tone-ok rect{fill:#e5f4ea;stroke:var(--d-ok)}.fd-tone-start rect{fill:#eef0f3;stroke:#7d879a}
.fd-tone-jump rect:first-of-type,.fd-cond rect:first-of-type,.fd-cond polygon{stroke-dasharray:6 3}
.fd-caption{font-size:10.5px;font-weight:700;fill:#5d677a}.fd-text{font-size:12px;fill:#1d2433}.fd-bold{font-weight:700}
.fd-sub{font-size:10.5px;fill:#2c56c9;font-family:ui-monospace,Menlo,monospace}
.fd-tone-error .fd-text{fill:var(--d-err)}
.fd-frame rect{fill:none;stroke-width:1.3;stroke-dasharray:7 4}
.fd-frame-tx rect{fill:#eef3fd;stroke:#4a72d1}.fd-frame-loop rect{stroke:#b9860b}.fd-frame-rollback rect{fill:#fdf1f1;stroke:var(--d-err)}.fd-frame-commit rect{stroke:var(--d-ok)}
.fd-frame-label{font-size:11px;font-weight:700;fill:#5d677a;font-family:ui-monospace,Menlo,monospace}
.fd-edge path{fill:none;stroke:#9aa3b2;stroke-width:1.4}.fd-edge-error path{stroke:var(--d-err)}.fd-edge-back path{stroke:#b9860b;stroke-dasharray:4 3}.fd-edge-dashed path{stroke-dasharray:5 4}
.fd-head{fill:#9aa3b2}.fd-head-err{fill:var(--d-err)}
.fd-edge-label{font-size:10.5px;fill:#4d576a;paint-order:stroke;stroke:#fafbfc;stroke-width:3px}
.hd-outline td:first-child{white-space:nowrap}
.hd-items td:nth-child(3) code,.hd-columns td:nth-child(3) code{white-space:nowrap;overflow-wrap:normal}
.hd-items td:nth-child(2){min-width:7em}.hd-items td:nth-child(4),.hd-items td:nth-child(5),.hd-items td:nth-child(6),.hd-items td:nth-child(7){white-space:nowrap}
.hd-tests td:nth-child(2),.hd-tests td:nth-child(5){white-space:nowrap}
.hd-columns td:nth-child(2){min-width:7em}.hd-columns td:nth-child(n+4):nth-child(-n+8){white-space:nowrap}
.lv-paper{border:1px solid var(--d-line);background:#f7f8fa;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:12.5px}
.lv-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.lv-h1{font-size:1.25em;font-weight:700;border-bottom:2px solid var(--d-ink);padding-bottom:3px}.lv-h2{font-size:1.08em;font-weight:700}.lv-h3{font-weight:700;color:var(--d-muted)}
.lv-text{margin:0}.lv-tone-muted,.lv-tone-note{color:var(--d-muted);font-size:.92em}.lv-tone-warning{background:#fff6e0;padding:3px 8px}
.lv-box{background:#fff;border:1px solid var(--d-line);border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:8px}
.lv-search-panel{background:#eef3fd}
.lv-box-title{font-weight:700}
.lv-grid{display:grid;gap:8px 14px}.lv-cols-1{grid-template-columns:1fr}.lv-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.lv-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.lv-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.lv-grid>:not(.lv-field){grid-column:1/-1}
.lv-columns{display:flex;gap:12px}
.lv-field{display:flex;flex-direction:column;gap:2px;min-width:0}
.lv-label{font-size:.9em;font-weight:600;color:var(--d-muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.lv-label code{font-weight:400;font-size:.85em}
.lv-req{font-size:10px;color:#fff;background:var(--d-err);padding:0 4px;border-radius:2px}
.lv-input{min-height:24px;border:1px solid #b9c1cd;border-radius:4px;background:#fff;padding:1px 6px}
.lv-display{border-bottom:1px dotted #b9c1cd;color:var(--d-muted)}
.lv-table-wrap{display:flex;flex-direction:column;gap:3px;overflow-x:auto}
.lv-table-title{font-weight:700;display:flex;gap:6px;align-items:baseline}
.lv-table{border-collapse:collapse;width:100%;background:#fff}.lv-table th,.lv-table td{border:1px solid var(--d-line);padding:3px 6px;text-align:left;font-size:.92em}.lv-table th{background:var(--d-fill)}
.lv-component{border:1px dashed var(--d-accent,#2b5bd7);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:6px;background:rgba(43,91,215,.04)}
.lv-component-tag{font-size:11px;font-weight:700;color:var(--d-accent,#2b5bd7)}
.lv-table-empty,.lv-image,.lv-html,.lv-missing{border:1px dashed #b9c1cd;padding:6px;color:var(--d-muted);text-align:center;background:#fff}
.lv-bar{display:flex;gap:6px;flex-wrap:wrap}.lv-align-right{justify-content:flex-end}.lv-align-center{justify-content:center}.lv-align-between{justify-content:space-between}
.lv-btn{display:inline-block;padding:2px 12px;border:1px solid #b9c1cd;border-radius:4px;background:#fff;font-weight:600}.lv-btn-primary{background:#2f5bd3;border-color:#2f5bd3;color:#fff}.lv-btn-danger{border-color:var(--d-err);color:var(--d-err)}
.lv-link{color:var(--d-accent);text-decoration:underline}
.lv-message{background:#e9effd;color:var(--d-accent);padding:4px 8px;border-radius:4px}
.lv-divider{border:0;border-top:1px solid var(--d-line);margin:0}
.lv-tabs .lv-tab-strip{display:flex;gap:2px;border-bottom:1px solid var(--d-line)}.lv-tab-strip span{padding:2px 10px}.lv-tab-strip .active{font-weight:700;border:1px solid var(--d-line);border-bottom:0;background:#fff}
@media (max-width:700px){.hd-info{grid-template-columns:1fr}.hd-counts{grid-template-columns:repeat(2,1fr)}.hd-cover,.hd-section{padding:18px}}
@media print{.hd-section{break-inside:auto;border:0;padding:0 0 12px}.hd-level-1{break-before:page}.hd-cover{break-after:page;border:0}}
`;
