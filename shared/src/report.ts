/**
 * 帳票 (紙に出力する帳票の設計) の型・検証・用紙の見本図 (HTML)。
 *
 * 原本は座標を持たない。部 (表題・明細・合計など) の並びと項目の幅から、決定的に見本図を描く
 * (同じ入力から同じ図)。アプリの編集画面と設計書 (HTML) で同じ関数を使う。
 *
 * 仕様: docs/spec/report.md
 */

export type ReportFormat = "pdf" | "excel" | "csv" | "html";
export type ReportPaper = "A4" | "A3" | "B4" | "B5" | "letter";
export type ReportOrientation = "portrait" | "landscape";
export type ReportSectionKind = "reportHeader" | "pageHeader" | "groupHeader" | "detail" | "groupFooter" | "reportFooter" | "pageFooter";
export type ReportFieldKind = "text" | "field" | "aggregate" | "pageNumber" | "date";
export type ReportAggregate = "sum" | "count" | "avg" | "min" | "max";

export interface ReportField {
  id: string;
  label?: string;
  kind: ReportFieldKind;
  source?: string;
  aggregate?: ReportAggregate;
  format?: string;
  align?: "left" | "center" | "right";
  width?: number;
  description?: string;
}
export interface ReportSection {
  id: string;
  kind: ReportSectionKind;
  name?: string;
  groupBy?: string;
  description?: string;
  fields: ReportField[];
}
export interface ReportParam { id: string; label: string; type?: string; required?: boolean; description?: string }
export interface Report {
  $schema?: string;
  version: 1;
  id: string;
  name: string;
  description?: string;
  maturity?: "draft" | "provisional" | "committed";
  output?: { format?: ReportFormat; paper?: ReportPaper; orientation?: ReportOrientation };
  trigger?: { kind?: "screen" | "batch" | "api"; screenRef?: string; processFlowRef?: string; description?: string };
  params?: ReportParam[];
  sort?: Array<{ field: string; order?: "asc" | "desc" }>;
  sections: ReportSection[];
  createdAt?: string;
  updatedAt?: string;
}

export const REPORT_SECTION_LABELS: Record<ReportSectionKind, string> = {
  reportHeader: "表題部", pageHeader: "ページヘッダ", groupHeader: "グループヘッダ", detail: "明細部",
  groupFooter: "グループフッタ", reportFooter: "合計部", pageFooter: "ページフッタ",
};
export const REPORT_FIELD_KIND_LABELS: Record<ReportFieldKind, string> = {
  text: "固定文言", field: "データ項目", aggregate: "集計", pageNumber: "ページ番号", date: "出力日",
};
export const REPORT_AGGREGATE_LABELS: Record<ReportAggregate, string> = { sum: "合計", count: "件数", avg: "平均", min: "最小", max: "最大" };
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = { pdf: "PDF", excel: "Excel", csv: "CSV", html: "HTML" };
export const REPORT_PAPER_MM: Record<ReportPaper, [number, number]> = { A4: [210, 297], A3: [297, 420], B4: [257, 364], B5: [182, 257], letter: [216, 279] };

// ── 検証 ───────────────────────────────────────────────────────────────────

export interface ReportIssue {
  severity: "error" | "warning" | "info";
  code: "duplicate-id" | "no-detail" | "group-without-key" | "field-without-source" | "aggregate-without-func" | "aggregate-in-detail"
    | "unknown-param" | "unknown-table" | "unknown-column" | "unknown-screen" | "unknown-flow" | "width-over" | "no-trigger";
  message: string;
  sectionId?: string;
  fieldId?: string;
}

export interface ReportRefs {
  screens?: ReadonlySet<string>;
  flows?: ReadonlySet<string>;
  /** テーブル ID → 列の物理名の集合 */
  tables?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** `source` を分解する。`@param.x` / `<テーブル ID>.<列>` / それ以外 (式など) */
export function parseSource(source: string): { kind: "param"; id: string } | { kind: "column"; table: string; column: string } | { kind: "other" } {
  if (source.startsWith("@param.")) return { kind: "param", id: source.slice("@param.".length) };
  const m = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source);
  return m ? { kind: "column", table: m[1], column: m[2] } : { kind: "other" };
}

/** 保存は妨げず、要確認として返す (draft-state 方針) */
export function validateReport(report: Report, refs: ReportRefs = {}): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const params = new Set((report.params ?? []).map((p) => p.id));
  const sectionIds = new Set<string>();
  const fieldIds = new Set<string>();
  const checkSource = (src: string | undefined, where: { sectionId?: string; fieldId?: string }, at: string) => {
    if (!src) return;
    const p = parseSource(src);
    if (p.kind === "param") {
      if (!params.has(p.id)) issues.push({ severity: "warning", code: "unknown-param", ...where, message: `${at}の出どころ「${src}」の出力条件が定義されていません` });
    } else if (p.kind === "column" && refs.tables) {
      const cols = refs.tables.get(p.table);
      if (!cols) issues.push({ severity: "warning", code: "unknown-table", ...where, message: `${at}の出どころ「${src}」のテーブル「${p.table}」が存在しません` });
      else if (!cols.has(p.column)) issues.push({ severity: "warning", code: "unknown-column", ...where, message: `${at}の出どころ「${src}」の列「${p.column}」がテーブル「${p.table}」にありません` });
    }
  };
  for (const s of report.sections) {
    if (sectionIds.has(s.id)) issues.push({ severity: "error", code: "duplicate-id", sectionId: s.id, message: `部 ID「${s.id}」が重複しています` });
    sectionIds.add(s.id);
    const sname = REPORT_SECTION_LABELS[s.kind] + (s.name ? `「${s.name}」` : "");
    if ((s.kind === "groupHeader" || s.kind === "groupFooter") && !s.groupBy) {
      issues.push({ severity: "warning", code: "group-without-key", sectionId: s.id, message: `${sname}にグループ化する項目 (groupBy) がありません` });
    }
    checkSource(s.groupBy, { sectionId: s.id }, sname);
    let total = 0;
    for (const f of s.fields) {
      if (fieldIds.has(f.id)) issues.push({ severity: "error", code: "duplicate-id", sectionId: s.id, fieldId: f.id, message: `項目 ID「${f.id}」が重複しています` });
      fieldIds.add(f.id);
      const at = `${sname}の項目「${f.label || f.id}」`;
      const where = { sectionId: s.id, fieldId: f.id };
      if ((f.kind === "field" || f.kind === "aggregate") && !f.source) issues.push({ severity: "warning", code: "field-without-source", ...where, message: `${at}にデータの出どころがありません` });
      if (f.kind === "aggregate") {
        if (!f.aggregate) issues.push({ severity: "warning", code: "aggregate-without-func", ...where, message: `${at}に集計の種類がありません` });
        if (s.kind === "detail") issues.push({ severity: "info", code: "aggregate-in-detail", ...where, message: `${at}は明細部の集計です (小計・合計は通常グループフッタ・合計部に置きます)` });
      }
      checkSource(f.source, where, at);
      total += f.width ?? 0;
    }
    if (total > 100.0001) issues.push({ severity: "warning", code: "width-over", sectionId: s.id, message: `${sname}の項目の幅の合計が ${Math.round(total * 10) / 10}% で、100% を超えています` });
  }
  if (report.output?.format !== "csv" && !report.sections.some((s) => s.kind === "detail")) {
    issues.push({ severity: "warning", code: "no-detail", message: "明細部がありません" });
  }
  const t = report.trigger;
  if (!t || (!t.kind && !t.screenRef && !t.processFlowRef && !t.description)) issues.push({ severity: "info", code: "no-trigger", message: "出力契機が書かれていません" });
  if (t?.screenRef && refs.screens && !refs.screens.has(t.screenRef)) issues.push({ severity: "warning", code: "unknown-screen", message: `出力契機の画面「${t.screenRef}」が存在しません` });
  if (t?.processFlowRef && refs.flows && !refs.flows.has(t.processFlowRef)) issues.push({ severity: "warning", code: "unknown-flow", message: `出力契機の処理フロー「${t.processFlowRef}」が存在しません` });
  return issues;
}

// ── 見本図 (HTML) ─────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 項目の見本値 (書式・種類から決める。実データではない) */
export function sampleValue(f: ReportField, row = 0): string {
  const fmt = f.format ?? "";
  if (f.kind === "pageNumber") return "1 / 1";
  if (f.kind === "date") return "2026/10/09";
  if (f.kind === "text") return f.label ?? "";
  const money = fmt.includes("¥");
  const num = /[#0]/.test(fmt) || f.aggregate === "sum" || f.aggregate === "count" || f.aggregate === "avg";
  if (/YYYY|yyyy|MM|DD/.test(fmt)) return "2026/10/09";
  if (f.kind === "aggregate" && f.aggregate === "count") return `${(row + 1) * 3}`;
  if (money) return `¥${(12340 * (row + 1)).toLocaleString("en-US")}`;
  if (num) return (1234 * (row + 1)).toLocaleString("en-US");
  return ["〇〇〇〇", "△△△△", "□□□□"][row % 3];
}

/** 項目の幅 (%)。指定が無い項目は、残りを均等に分ける (最小 8%) */
export function fieldWidths(fields: readonly ReportField[]): number[] {
  const given = fields.reduce((a, f) => a + (f.width ?? 0), 0);
  const blanks = fields.filter((f) => f.width === undefined).length;
  const each = blanks ? Math.max(8, (100 - given) / blanks) : 0;
  return fields.map((f) => f.width ?? each);
}

export interface ReportHtmlOptions {
  /** 見本の明細の行数 (既定 3) */
  detailRows?: number;
  /** 項目を選択可能にする (編集画面用)。data-field / data-section と testid を付ける */
  interactive?: boolean;
  selected?: { sectionId?: string; fieldId?: string };
}

/**
 * 用紙の見本図を HTML にする。色は CSS クラス (rp-*) で指定するので、置く側のスタイルで決まる。
 * 設計書では DESIGN_DOC_CSS、アプリでは reports.css が rp-* を定義する。
 */
export function reportToHtml(report: Pick<Report, "sections" | "output" | "name">, opts: ReportHtmlOptions = {}): string {
  const paper = report.output?.paper ?? "A4";
  const orient = report.output?.orientation ?? "portrait";
  const [w, h] = REPORT_PAPER_MM[paper];
  const pw = orient === "landscape" ? h : w, ph = orient === "landscape" ? w : h;
  const rows = opts.detailRows ?? 3;
  const inter = opts.interactive;
  const parts: string[] = [];
  parts.push(`<div class="rp-paper rp-${paper} rp-${orient}" style="aspect-ratio:${pw} / ${ph}" data-paper="${paper}" data-orientation="${orient}">`);
  if (!report.sections.length) parts.push(`<p class="rp-empty">部がありません。</p>`);
  for (const s of report.sections) {
    const widths = fieldWidths(s.fields);
    const sel = inter && opts.selected?.sectionId === s.id && !opts.selected.fieldId;
    const label = `${REPORT_SECTION_LABELS[s.kind]}${s.name ? `: ${s.name}` : ""}${s.groupBy ? ` (${s.groupBy} ごと)` : ""}`;
    const cell = (f: ReportField, i: number, value: string, head = false) => {
      const fsel = inter && opts.selected?.fieldId === f.id && opts.selected.sectionId === s.id;
      const attrs = inter && !head ? ` data-section="${esc(s.id)}" data-field="${esc(f.id)}" data-testid="rp-field-${esc(f.id)}" tabindex="0" role="button"` : "";
      return `<div class="rp-cell rp-${f.align ?? "left"} rp-k-${f.kind}${head ? " rp-head" : ""}${fsel ? " rp-selected" : ""}" style="flex:0 0 ${Math.round(widths[i] * 100) / 100}%"${attrs}>${esc(value)}</div>`;
    };
    parts.push(`<section class="rp-section rp-s-${s.kind}${sel ? " rp-selected" : ""}"${inter ? ` data-section="${esc(s.id)}" data-testid="rp-section-${esc(s.id)}"` : ""}><span class="rp-tag">${esc(label)}</span>`);
    if (!s.fields.length) parts.push(`<div class="rp-row"><span class="rp-empty">項目がありません</span></div>`);
    else if (s.kind === "detail") {
      parts.push(`<div class="rp-row rp-labels">${s.fields.map((f, i) => cell(f, i, f.label || f.id, true)).join("")}</div>`);
      for (let r = 0; r < rows; r++) parts.push(`<div class="rp-row">${s.fields.map((f, i) => cell(f, i, sampleValue(f, r))).join("")}</div>`);
    } else {
      parts.push(`<div class="rp-row">${s.fields.map((f, i) => {
        const v = f.kind === "text" ? (f.label ?? "") : `${f.kind === "aggregate" ? `${REPORT_AGGREGATE_LABELS[f.aggregate ?? "sum"]} ` : (f.label ? `${f.label} ` : "")}${sampleValue(f)}`;
        return cell(f, i, v);
      }).join("")}</div>`);
    }
    parts.push(`</section>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

// ── 編集の補助・関連の追従 ─────────────────────────────────────────────

export function nextReportSectionId(report: Pick<Report, "sections">, base = "section"): string {
  const used = new Set(report.sections.map((s) => s.id));
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function nextReportFieldId(report: Pick<Report, "sections">, base = "field"): string {
  const used = new Set(report.sections.flatMap((s) => s.fields.map((f) => f.id)));
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** 部の種類を追加するときの既定の名前 */
export function defaultSectionName(kind: ReportSectionKind): string {
  return REPORT_SECTION_LABELS[kind];
}

/** 画面 / 処理フロー / テーブルの ID 改名を、出力契機と項目の出どころに反映する。変えたら true */
export function renameReportRefs(report: Report, kind: "screen" | "processFlow" | "table", from: string, to: string): boolean {
  let changed = false;
  if (kind === "screen" && report.trigger?.screenRef === from) { report.trigger.screenRef = to; changed = true; }
  if (kind === "processFlow" && report.trigger?.processFlowRef === from) { report.trigger.processFlowRef = to; changed = true; }
  if (kind === "table") {
    const re = (s: string | undefined) => (s && s.startsWith(`${from}.`) ? `${to}.${s.slice(from.length + 1)}` : s);
    for (const s of report.sections) {
      const g = re(s.groupBy); if (g !== s.groupBy) { s.groupBy = g; changed = true; }
      for (const f of s.fields) { const v = re(f.source); if (v !== f.source) { f.source = v; changed = true; } }
    }
    for (const o of report.sort ?? []) { const v = re(o.field); if (v !== o.field) { o.field = v!; changed = true; } }
  }
  return changed;
}
