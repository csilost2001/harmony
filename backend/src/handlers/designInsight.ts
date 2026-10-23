/**
 * 設計を「探す・部分で読む・言葉で読む・検証だけ・比べる」MCP tool handler (すべて読み取り専用。設計は書き換えない)。
 *
 * - designer__search_design        設計全体の本文検索 (画面・テーブル・処理フロー・汎用定義 など。画面の検索と同じ)
 * - designer__list_steps           処理フローの工程の一覧 (番号・種類・要点。中身は get_step で読む)
 * - designer__get_step             1 つの工程の原本 + 親の経路 + 言葉
 * - designer__get_flow_story       処理フローを「流れ」の文章で返す (画面の「流れ」表示・設計書と同じ言葉)
 * - designer__analyze_branches     分岐の判定表 (条件 × 道) と、抜け・隠れ・重なりの指摘
 * - designer__validate_design      保存せずに、JSON がスキーマ・検証に合うかを確かめる
 * - designer__get_changes_since    ある時刻より後に変わった設計ファイル
 * - designer__compare_workspaces   2 つのワークスペースの設計を、種類ごとに id で比べる
 * - designer__get_design_document  設計書の目次と、章ごとの本文 (読みやすい文章。画面の「設計書」と同じ内容)
 *
 * 仕様: docs/spec/mcp-design-access.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  branchConditionText, buildDecisionModel, buildDesignDocument, buildOutline, buildVarLabels, conditionText, decisionColumnName, isGuardLike, noteWithWords, stepChildLists, validateBusinessFlow, validateReport,
  type FlowActionLike, type FlowContext, type FlowStep, type OutlineRow,
} from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import { searchDesign } from "../designSearch.js";
import { describeAjvError } from "../ajvMessages.js";
import { readProcessFlow, validateEntitySchema } from "../projectStorage.js";
import { resolveDataRoot } from "../storageCore.js";
import { findById, findByPath } from "../recentStore.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { pageOf } from "./designKinds.js";
import { tools as allTools } from "../tools.js";
import { toolAnnotations } from "../mcpToolMeta.js";
import { filterTools } from "../security/mcpAccess.js";
import { PROFILES, isInProfile } from "../security/mcpProfiles.js";
import { wsBridge } from "../wsBridge.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (m: string) => new McpError(ErrorCode.InvalidParams, m);

interface FlowDoc { meta?: { id?: string; name?: string }; actions?: Array<FlowActionLike & { id?: string; name?: string; steps?: FlowStep[]; inputs?: Array<{ name: string; label?: string }> }> }

/** 画面で開いていれば未保存の内容を、なければファイルを読む (get_process_flow と同じ) */
async function loadFlow(a: Record<string, unknown>, root: string): Promise<FlowDoc> {
  assertEntityIdMcp(a.processFlowId, "processFlowId");
  const live = await wsBridge.tryCommand("getProcessFlow", { id: a.processFlowId });
  const doc = live ?? (await readProcessFlow(a.processFlowId, root));
  if (!isRecord(doc)) throw bad(`処理フロー ${a.processFlowId} が見つかりません (designer__list_process_flows で一覧)`);
  return doc as FlowDoc;
}

function actionsOf(doc: FlowDoc, actionId: unknown) {
  const all = Array.isArray(doc.actions) ? doc.actions.filter(isRecord) : [];
  if (typeof actionId !== "string") return all;
  const one = all.filter((x) => x.id === actionId);
  if (one.length === 0) throw bad(`アクション「${actionId}」が見つかりません (${all.map((x) => x.id).join(", ")})`);
  return one;
}

async function flowContext(root: string): Promise<FlowContext> {
  const { input } = await loadDesignInputFromRoot(root);
  const tables = new Map(input.tables.filter(isRecord).map((t) => [String(t.id), (t.name as string | undefined) || (t.physicalName as string | undefined)]));
  const screens = new Map(input.screens.filter(isRecord).map((s) => [String(s.id), s.name as string | undefined]));
  return { tableName: (id) => tables.get(id), screenName: (id) => screens.get(id) };
}

/** 工程を id で探す。見つかったら、そこまでの親 (工程と、入っている枠の役割) も返す。入れ子の置き場所は shared の stepChildLists にすべてある */
function findStep(steps: readonly FlowStep[] | undefined, id: string, trail: Array<{ id?: string; kind?: string; role: string }> = []): { step: FlowStep; trail: typeof trail } | null {
  for (const s of steps ?? []) {
    if (!isRecord(s)) continue;
    if (s.id === id) return { step: s, trail };
    for (const g of stepChildLists(s)) {
      const r = findStep(g.steps, id, [...trail, { id: s.id as string | undefined, kind: s.kind as string | undefined, role: g.role }]);
      if (r) return r;
    }
  }
  return null;
}

const rowBrief = (r: OutlineRow) => ({
  no: r.no, depth: r.depth, type: r.type, ...(r.step ? { id: (r.step as { id?: string }).id } : {}), kind: r.kind, text: r.text,
  ...(r.target ? { target: r.target } : {}), ...(r.note ? { note: r.note } : {}), ...(r.runIf ? { runIf: r.runIf } : {}), ...(r.inTx ? { inTx: true } : {}), ...(r.isError ? { isError: true } : {}),
});

/** 「流れ」の文章 (Markdown)。画面の「流れ」表示・設計書と同じ、条件を言葉にした読み方 */
function storyOf(doc: FlowDoc, actions: ReturnType<typeof actionsOf>, ctx: FlowContext): string {
  const out: string[] = [`# ${doc.meta?.name || doc.meta?.id || "処理フロー"} (${doc.meta?.id ?? ""})`];
  for (const act of actions) {
    const labels = buildVarLabels(act as never);
    out.push("", `## アクション: ${act.name || act.id || "(名前なし)"}${act.id ? ` (${act.id})` : ""}`);
    for (const r of buildOutline(act.steps ?? [], act, ctx)) {
      const pad = "  ".repeat(r.depth);
      if (r.type === "branch-arm") {
        const cond = r.condition !== undefined ? conditionText(r.condition, labels) || branchConditionText(r.condition) || "" : "";
        out.push(`${pad}- ${r.no} ${r.kind === "上記以外" ? "上記以外のとき" : `${cond ? `${cond} のとき` : r.text}`}${r.text && cond && r.text !== cond ? ` (${r.text})` : ""}`);
        continue;
      }
      const note = noteWithWords(r.note, r.runIf, labels);
      const where = r.target ? ` → ${r.target}` : "";
      const id = (r.step as { id?: string } | undefined)?.id;
      out.push(`${pad}- ${r.no} [${r.kind}] ${r.text}${where}${r.inTx ? " (トランザクション内)" : ""}${r.isError ? " (異常終了)" : ""}${id ? ` {${id}}` : ""}`);
      if (note.text) out.push(`${pad}  - ${note.text}`);
    }
  }
  return out.join("\n");
}

/** 設計書 HTML のうち、id の章 (<section id="…">) だけを取り出す。入れ子の <section> を数えて、対応する閉じまで */
export function sliceChapter(html: string, id: string): string | null {
  const m = new RegExp(`<section\\b[^>]*\\bid="${id.replace(/[^A-Za-z0-9_-]/g, "")}"[^>]*>`).exec(html);
  if (!m) return null;
  let depth = 0;
  const re = /<(\/?)section\b[^>]*>/g;
  re.lastIndex = m.index;
  for (let t = re.exec(html); t; t = re.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(m.index, re.lastIndex);
  }
  return html.slice(m.index);
}

/** HTML → 読みやすい文章 (見出しは #、表は 1 行 1 行を ` | ` 区切り)。AI が読む用。文字参照は戻す */
export function htmlToText(html: string): string {
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return dec(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
      .replace(/<h([1-4])\b[^>]*>/g, (_m, n: string) => `\n${"#".repeat(Number(n))} `)
      .replace(/<\/h[1-4]>/g, "\n")
      .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/g, " | ")
      .replace(/<\/(tr|p|li|div|section|table|ul|ol|dt|dd)>/g, "\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 設計ファイルの種類 (ディレクトリ名) */
const DIR_KIND: Record<string, string> = {
  screens: "screen", tables: "table", "process-flows": "processFlow", sequences: "sequence", views: "view", "view-definitions": "viewDefinition",
  "screen-items": "screenItems", "business-flows": "businessFlow", reports: "report", "page-layouts": "pageLayout", "generic-definitions": "genericDefinition",
};

async function walkJson(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .harmony-backups など、設計ではないもの
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkJson(p, depth + 1));
    else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

export const handleDesignInsightTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};
  switch (name) {
    case "designer__search_design": {
      if (typeof a.query !== "string" || !a.query.trim()) throw bad("query は必須です (2 文字以上)");
      const limit = typeof a.limit === "number" && Number.isFinite(a.limit) ? Math.max(1, Math.min(100, Math.floor(a.limit))) : 30;
      const hits = await searchDesign(root, a.query, limit);
      return json({ query: a.query, count: hits.length, hits, note: "名前・id での検索は designer__list_* で。ここは設計の本文 (説明・項目・SQL・条件など) の一致" });
    }

    case "designer__list_steps": {
      const doc = await loadFlow(a, root);
      const ctx = await flowContext(root);
      const actions = actionsOf(doc, a.actionId).map((act) => {
        const pg = pageOf(buildOutline(act.steps ?? [], act, ctx).map(rowBrief), a, 300);
        return { actionId: act.id, name: act.name, total: pg.total, offset: pg.offset, hasMore: pg.hasMore, steps: pg.items };
      });
      return json({ processFlowId: doc.meta?.id, actions });
    }

    case "designer__get_step": {
      assertEntityIdMcp(a.processFlowId, "processFlowId");
      if (typeof a.stepId !== "string" || !a.stepId) throw bad("stepId は必須です (designer__list_steps で一覧)");
      const doc = await loadFlow(a, root);
      for (const act of actionsOf(doc, a.actionId)) {
        const found = findStep(act.steps, a.stepId);
        if (!found) continue;
        const labels = buildVarLabels(act as never);
        const s = found.step as Record<string, unknown>;
        const words = typeof s.runIf === "string" && s.runIf ? { runIf: conditionText({ kind: "expression", expression: s.runIf }, labels) } : {};
        return json({ processFlowId: doc.meta?.id, actionId: act.id, path: found.trail, ...words, step: found.step });
      }
      throw bad(`工程「${a.stepId}」が見つかりません (designer__list_steps で一覧)`);
    }

    case "designer__get_flow_story": {
      const doc = await loadFlow(a, root);
      return text(storyOf(doc, actionsOf(doc, a.actionId), await flowContext(root)));
    }

    case "designer__analyze_branches": {
      const doc = await loadFlow(a, root);
      const results: Array<Record<string, unknown>> = [];
      for (const act of actionsOf(doc, a.actionId)) {
        const labels = buildVarLabels(act as never);
        const visit = (steps: readonly FlowStep[] | undefined) => {
          for (const s of steps ?? []) {
            if (!isRecord(s)) continue;
            if (s.kind === "branch" && (typeof a.stepId !== "string" || a.stepId === s.id)) {
              const model = buildDecisionModel(s as FlowStep, { implicitElse: isGuardLike(s as FlowStep), label: labels.full });
              if (model) {
                results.push({
                  actionId: act.id, stepId: s.id, complete: model.complete,
                  rows: model.rows.map((r) => ({ key: r.key, text: r.raw || (r.clause ? `${r.clause.subject} ${r.clause.op}${r.clause.value ? ` ${r.clause.value}` : ""}` : "") })),
                  columns: model.columns.map((c) => ({ name: decisionColumnName(c), cells: c.cells, ...(c.unparsed ? { unparsed: c.unparsed } : {}), ...(c.contradictory ? { contradictory: true } : {}) })),
                  issues: model.issues,
                });
              }
            }
            for (const g of stepChildLists(s)) visit(g.steps);
          }
        };
        visit(act.steps);
      }
      return json({
        processFlowId: doc.meta?.id, branches: results,
        note: "分岐は上から順に調べ、最初に成り立った道だけを実行する (docs/spec/process-flow-runtime-conventions.md §11.5)。issues の warn は、隠れる道・同時に成り立つ道・どの道にも入らない組み合わせ",
      });
    }

    case "designer__validate_design": {
      const kind = a.kind;
      if (!isRecord(a.design)) throw bad("design は JSON のオブジェクトで指定してください");
      if (kind === "processFlow" || kind === "screen" || kind === "table") {
        const errors = await validateEntitySchema(kind, a.design);
        return json({ kind, valid: errors.length === 0, issues: errors.map((e) => ({ severity: "warning", message: `スキーマ: ${describeAjvError(e)}`, path: e.instancePath })), note: "保存していません。保存は add_* / update_* / save_*。保存後の点検は check_design" });
      }
      if (kind === "report") {
        // 参照先の確認は読むだけ (フォルダを作らない読み込みで集める)
        const { input } = await loadDesignInputFromRoot(root);
        const refs = {
          screens: new Set(input.screens.map((x) => x.id)), flows: new Set(input.flows.map((x) => x.meta.id)),
          tables: new Map(input.tables.map((t) => [t.id, new Set((t.columns ?? []).map((c) => c.physicalName))] as const)),
        };
        const issues = validateReport(a.design as never, refs);
        return json({ kind, valid: !issues.some((i) => i.severity === "error"), issues, note: "保存していません" });
      }
      if (kind === "businessFlow") {
        const issues = validateBusinessFlow(a.design as never, {});
        return json({ kind, valid: !issues.some((i) => i.severity === "error"), issues, note: "保存していません。参照先の確認は保存後の check_design で" });
      }
      throw bad("kind は processFlow / screen / table / report / businessFlow のどれかです (ほかの種類は、スキーマの検査の対象外です)");
    }

    case "designer__get_changes_since": {
      if (a.since !== undefined && typeof a.since !== "string") throw bad("since は ISO の日時の文字列で指定してください");
      const sinceMs = typeof a.since === "string" ? Date.parse(a.since) : Date.now() - 24 * 3600 * 1000;
      if (!Number.isFinite(sinceMs)) throw bad("since は ISO の日時で指定してください (例: 2026-10-24T09:00:00+09:00)。省略すると直近 24 時間");
      const dataRoot = await resolveDataRoot(root);
      const changes: Array<{ kind: string; id: string; file: string; modifiedAt: string }> = [];
      for (const file of await walkJson(dataRoot)) {
        const st = await fs.stat(file).catch(() => null);
        if (!st || st.mtimeMs <= sinceMs) continue;
        const rel = path.relative(dataRoot, file).split(path.sep).join("/");
        const top = rel.split("/")[0];
        changes.push({ kind: DIR_KIND[top] ?? (rel.includes("/") ? top : "project"), id: path.basename(file, ".json"), file: rel, modifiedAt: st.mtime.toISOString() });
      }
      changes.sort((x, y) => y.modifiedAt.localeCompare(x.modifiedAt));
      return json({ since: new Date(sinceMs).toISOString(), count: changes.length, changes: changes.slice(0, 200), ...(changes.length > 200 ? { truncated: true } : {}) });
    }

    case "designer__get_tool_guide": {
      if (typeof a.name !== "string") {
        // 名前を省略すると、この環境で使える tool の名前の一覧 (拒否した tool・読み取り専用で使えない tool は出さない)
        const usable = filterTools(allTools);
        return json({ count: usable.length, tools: usable.map((t) => t.name.replace(/^designer__/, "")), note: "tool 1 つの詳細 (説明・引数・注釈) は name を指定して読む" });
      }
      const wanted = a.name.startsWith("designer__") || a.name.startsWith("editSession__") ? a.name : `designer__${a.name}`;
      const t = filterTools(allTools).find((x) => x.name === wanted);
      if (!t) throw bad(`tool「${a.name}」がありません (name を省略すると一覧)`);
      return json({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: toolAnnotations(t.name), profiles: Object.keys(PROFILES).filter((p) => isInProfile(t.name, [p])) });
    }

    case "designer__get_design_document": {
      const { input } = await loadDesignInputFromRoot(root);
      const doc = buildDesignDocument(input);
      if (typeof a.chapter !== "string") {
        return json({ toc: doc.toc, issues: { error: doc.issues.filter((i) => i.severity === "error").length, warning: doc.issues.filter((i) => i.severity === "warning").length }, note: "章の本文は chapter に toc の id を指定して読む (format: text は文章、html は設計書の HTML のまま)" });
      }
      if (!/^[A-Za-z0-9_-]+$/.test(a.chapter)) throw bad("chapter は目次の id (英数字・_・-) で指定してください");
      if (a.format !== undefined && a.format !== "text" && a.format !== "html") throw bad("format は text / html のどちらかです");
      const html = sliceChapter(doc.html, a.chapter);
      if (!html) throw bad(`章「${a.chapter}」が見つかりません。目次は chapter を省略して読めます`);
      const MAX = 60000;
      const body = a.format === "html" ? html : htmlToText(html);
      return text(body.length > MAX ? `${body.slice(0, MAX)}\n\n(長いので ${MAX} 文字で切りました。より小さい章 (toc の level 2) を指定してください)` : body);
    }

    case "designer__compare_workspaces": {
      if (typeof a.other !== "string" || !a.other) throw bad("other は、比べる相手のワークスペースの id またはパスです (designer__workspace_list で一覧)");
      const entry = (await findById(a.other)) ?? (await findByPath(a.other));
      if (!entry) throw bad("other は、登録済みのワークスペース (designer__workspace_list にあるもの) の id またはパスで指定してください");
      const [mine, theirs] = await Promise.all([loadDesignInputFromRoot(root), loadDesignInputFromRoot(entry.path)]);
      const idsOf = (i: typeof mine.input) => ({
        screens: i.screens.map((x) => x.id), tables: i.tables.map((x) => x.id), flows: i.flows.map((x) => x.meta.id),
        businessFlows: (i.businessFlows ?? []).map((x) => (x as { id: string }).id), reports: (i.reports ?? []).map((x) => (x as { id: string }).id),
      });
      const m = idsOf(mine.input), t = idsOf(theirs.input);
      const diff: Record<string, { onlyHere: string[]; onlyThere: string[]; both: number }> = {};
      for (const k of Object.keys(m) as Array<keyof typeof m>) {
        const there = new Set(t[k]), here = new Set(m[k]);
        diff[k] = { onlyHere: m[k].filter((x) => !there.has(x)), onlyThere: t[k].filter((x) => !here.has(x)), both: m[k].filter((x) => there.has(x)).length };
      }
      return json({ here: mine.input.project.name, there: entry.name, diff, note: "id の有無の比較です。同じ id の中身の違いは、各ワークスペースで get_* して比べてください" });
    }

    default:
      return null;
  }
};
