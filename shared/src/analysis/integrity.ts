/**
 * 設計どうしの参照の整合 (要確認): 設計が、実在しないものを指していないか。
 *
 * - 処理フローの DB アクセスのテーブル・画面・画面遷移の行き先・画面項目から呼ぶ処理フロー / アクション
 * - 画面項目のテーブルの列への結びつき、テーブルの外部キーの参照先
 * - 工程の id の重複、レスポンス返却の `responseId`、分岐の道の条件が空
 * - 規約の参照 (`@conv.limit.*` `@conv.regex.*` `@conv.msg.*` `@conv.role.*` `@conv.permission.*`) が、規約に定義されているか
 *
 * 画面側の検査 (frontend/src/schemas の各 Validator と `validate:samples`) は、式の中の変数・SQL の列・画面項目の型など、より細かい契約を見る。
 * ここは、AI が `designer__check_design` で最後に確かめるときに、参照の切れた設計を見逃さないための、設計の外へ向かう参照の検査。
 * 純粋関数で、書き込まない。仕様: docs/spec/design-check.md
 */
import type { DesignDocInput, DocIssue } from "../designDocument.js";
import type { FlowStep } from "../flowStructure.js";
import { stepChildLists } from "../flowWords.js";
import { jsonText } from "./common.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 工程を入れ子ごと、(アクションの id・工程) で歩く */
function* stepsOf(steps: readonly FlowStep[] | undefined): Generator<FlowStep> {
  for (const s of steps ?? []) {
    if (!isRecord(s)) continue;
    yield s as FlowStep;
    for (const g of stepChildLists(s)) yield* stepsOf(g.steps);
  }
}

export function checkIntegrity(input: DesignDocInput): DocIssue[] {
  const out: DocIssue[] = [];
  const screenIds = new Set(input.screens.map((s) => s.id));
  const flowIds = new Map(input.flows.map((f) => [f.meta.id, f] as const));
  const tableById = new Map(input.tables.map((t) => [t.id, t] as const));
  const warn = (section: string, message: string, ref?: DocIssue["ref"]): void => { out.push({ severity: "warning", section, message, ...(ref ? { ref } : {}) }); };

  // ── 処理フロー ──
  for (const f of input.flows) {
    const sec = `処理フロー ${f.meta.name ?? f.meta.id}`;
    const ref = { kind: "processFlow" as const, id: f.meta.id };
    if (f.meta.screenId && !screenIds.has(f.meta.screenId)) warn(sec, `呼び出す画面「${f.meta.screenId}」がありません (meta.screenId)`, ref);
    const across = new Map<string, number>(); // 工程 id → それを持つアクションの数
    for (const a of f.actions ?? []) {
      const ids = new Map<string, number>();
      const responseIds = new Set((a.responses ?? []).map((r) => r.id));
      for (const s of stepsOf(a.steps as FlowStep[] | undefined)) {
        const x = s as Record<string, unknown>;
        const at = `アクション ${a.id ?? "?"} の工程 ${String(x.id ?? "?")}`;
        if (typeof x.id === "string") ids.set(x.id, (ids.get(x.id) ?? 0) + 1);
        if (x.kind === "dbAccess" && typeof x.tableId === "string" && x.tableId && !tableById.has(x.tableId)) warn(sec, `${at}: テーブル「${x.tableId}」がありません (tableId)`, ref);
        if (x.kind === "screenTransition" && typeof x.targetScreenId === "string" && x.targetScreenId && !screenIds.has(x.targetScreenId)) warn(sec, `${at}: 遷移先の画面「${x.targetScreenId}」がありません (targetScreenId)`, ref);
        if (x.kind === "return" && typeof x.responseId === "string" && x.responseId && !responseIds.has(x.responseId)) warn(sec, `${at}: レスポンス「${x.responseId}」が、このアクションの responses にありません (responseId)`, ref);
        const ng = isRecord(x.inlineBranch) ? x.inlineBranch.ngResponseId : undefined;
        if (typeof ng === "string" && ng && !responseIds.has(ng)) warn(sec, `${at}: NG のときのレスポンス「${ng}」が、このアクションの responses にありません (inlineBranch.ngResponseId)`, ref);
        if (x.kind === "branch" && Array.isArray(x.branches)) {
          for (const b of x.branches as Array<Record<string, unknown>>) {
            const c = b?.condition;
            if (isRecord(c) && (c.kind === undefined || c.kind === "expression") && typeof c.expression === "string" && !c.expression.trim()) warn(sec, `${at}: 道「${String(b.code ?? b.id ?? "?")}」の条件が空です (常に成り立たない扱いになります)`, ref);
          }
        }
      }
      for (const [id, n] of ids) {
        if (n > 1) warn(sec, `アクション ${a.id ?? "?"} で、工程の id「${id}」が ${n} 回使われています (id は一意にしてください)`, ref);
        across.set(id, (across.get(id) ?? 0) + 1);
      }
    }
    // アクションをまたぐ重複は、動作は壊れないが、工程を id で指す操作 (update_step など) は、最初に見つかった方に当たる
    const shared = [...across].filter(([, n]) => n > 1).map(([id]) => id);
    if (shared.length) out.push({ severity: "info", section: sec, message: `アクションをまたいで、同じ工程の id が使われています (${shared.slice(0, 5).map((x) => `「${x}」`).join("")}${shared.length > 5 ? ` ほか ${shared.length - 5} 件` : ""})。工程を id で指す操作 (update_step など) は、最初に見つかったアクションの工程に当たります`, ref });
  }

  // ── 画面項目 → テーブルの列・処理フロー ──
  for (const s of input.screens) {
    const sec = `画面 ${s.name ?? s.id}`;
    const ref = { kind: "screen" as const, id: s.id };
    for (const it of s.items ?? []) {
      const r = it.binding?.ref;
      if (it.binding?.kind === "tableColumn" && r?.tableId) {
        const t = tableById.get(r.tableId);
        if (!t) warn(sec, `項目「${it.id}」の結びつき先のテーブル「${r.tableId}」がありません (binding.ref.tableId)`, ref);
        else if (r.columnId && !(t.columns ?? []).some((c) => c.id === r.columnId || c.physicalName === r.columnId)) warn(sec, `項目「${it.id}」の結びつき先のカラム「${r.columnId}」が、テーブル「${t.name ?? t.id}」にありません (binding.ref.columnId)`, ref);
      }
      for (const ev of it.events ?? []) {
        if (!ev.handlerFlowId) continue;
        const flow = flowIds.get(ev.handlerFlowId);
        if (!flow) warn(sec, `項目「${it.id}」のイベントが呼ぶ処理フロー「${ev.handlerFlowId}」がありません (handlerFlowId)`, ref);
        else if (ev.handlerActionId && !(flow.actions ?? []).some((a) => a.id === ev.handlerActionId)) warn(sec, `項目「${it.id}」のイベントが呼ぶアクション「${ev.handlerActionId}」が、処理フロー「${flow.meta.name ?? flow.meta.id}」にありません (handlerActionId)`, ref);
      }
    }
  }

  // ── テーブルの外部キー ──
  for (const t of input.tables) {
    for (const c of t.constraints ?? []) {
      if (c.kind !== "foreignKey" || c.noConstraint || !c.referencedTableId) continue;
      const rt = tableById.get(c.referencedTableId);
      const sec = `テーブル ${t.name ?? t.id}`;
      const ref = { kind: "table" as const, id: t.id };
      if (!rt) warn(sec, `外部キーの参照先のテーブル「${c.referencedTableId}」がありません (referencedTableId)`, ref);
      else for (const cid of c.referencedColumnIds ?? []) if (!(rt.columns ?? []).some((col) => col.id === cid || col.physicalName === cid)) warn(sec, `外部キーの参照先のカラム「${cid}」が、テーブル「${rt.name ?? rt.id}」にありません (referencedColumnIds)`, ref);
    }
  }

  // ── 規約の参照 (規約の側が定義されているときだけ) ──
  // 規約の参照: `@conv.<種類>.<キー>` のキーは、英数字・_・.・-・: (権限は `product:view` の形)。`@conv.limit.max-1` のように、あとに式が続くこともあるので、
  // 定義されたキーのどれかで始まり、続きが . - [ から始まるものは、そのキーへの参照として扱う
  const refKeys = (text: string, cat: string): Set<string> => {
    const out = new Set<string>();
    for (const m of text.matchAll(new RegExp(`@conv\\.${cat}\\.([A-Za-z0-9_.:\\-]*[A-Za-z0-9_])`, "g"))) out.add(m[1]);
    return out;
  };
  const resolves = (k: string, defs: Record<string, unknown>): boolean => k in defs || Object.keys(defs).some((d) => k.startsWith(d) && /^[.\-[]/.test(k.slice(d.length)));
  const groups: Array<[string, "limit" | "regex" | "msg" | "role" | "permission", Record<string, unknown> | undefined]> = [
    ["上限値", "limit", input.limits], ["正規表現", "regex", input.regex], ["メッセージ", "msg", input.messages], ["ロール", "role", input.roles], ["権限", "permission", input.permissions],
  ];
  for (const f of input.flows) {
    const text = jsonText(f);
    for (const [label, cat, defs] of groups) {
      // 規約が読めていない (定義がひとつもない) ときは、見ない。全部の参照が「未定義」になって、本当の原因が埋もれるため
      if (!defs || Object.keys(defs).length === 0) continue;
      for (const k of refKeys(text, cat)) {
        if (resolves(k, defs)) continue;
        warn(`処理フロー ${f.meta.name ?? f.meta.id}`, `規約の${label}「@conv.${cat}.${k}」が、規約に定義されていません`, { kind: "processFlow", id: f.meta.id });
      }
    }
  }
  return out;
}
