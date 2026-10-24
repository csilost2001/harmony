/**
 * 設計どうしの参照の整合 (要確認): 設計が、実在しないものを指していないか。
 *
 * - 処理フローの DB アクセスのテーブル・画面・画面遷移の行き先・画面項目から呼ぶ処理フロー / アクション
 * - 画面項目のテーブルの列への結びつき、テーブルの外部キーの参照先
 * - 工程の id の重複、レスポンス返却の `responseId`、分岐の道の条件が空
 * - 共通処理の呼び出し (`commonProcess`) の引数と、呼び先の入力の食い違い (余分な引数・必須の入力に渡していない)
 * - 結果の形の宣言 (`outputBinding.shape`) と、あとの工程での読み方の食い違い (一覧を項目名で読む・1 件を添字で読む)
 * - 上のほか、スキーマの `x-ref-kind` (schemas/v3 の参照の宣言) がついた項目が指す、テーブル・画面・処理フローの有無 (どこに書かれていても)
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
import { REF_KINDS_BY_PROPERTY } from "./refKinds.generated.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 工程を入れ子ごと、(アクションの id・工程) で歩く */
function* stepsOf(steps: readonly FlowStep[] | undefined): Generator<FlowStep> {
  for (const s of steps ?? []) {
    if (!isRecord(s)) continue;
    yield s as FlowStep;
    for (const g of stepChildLists(s)) yield* stepsOf(g.steps);
  }
}

/** 工程自身の文字 (入れ子の工程・結果の束縛・id を除く)。変数の読み方を調べる */
const OWN_SKIP = new Set(["subSteps", "steps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout", "outputBinding", "id"]);
const ownText = (s: unknown): string => JSON.stringify(s, (k, v) => (OWN_SKIP.has(k) ? undefined : v)) ?? "";
const ARRAY_MEMBERS = "length|map|filter|find|findIndex|some|every|reduce|forEach|includes|slice|join|concat|indexOf|sort|flatMap|at|push";
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function checkIntegrity(input: DesignDocInput): DocIssue[] {
  const out: DocIssue[] = [];
  const screenIds = new Set(input.screens.map((s) => s.id));
  const flowIds = new Map(input.flows.map((f) => [f.meta.id, f] as const));
  const tableById = new Map(input.tables.map((t) => [t.id, t] as const));
  const warn = (section: string, message: string, ref?: DocIssue["ref"]): void => { out.push({ severity: "warning", section, message, ...(ref ? { ref } : {}) }); };
  // 個別の検査 (上の文言つき) で見た参照。x-ref-kind の一般の検査は、同じ参照を二度指摘しない
  const handled = new WeakMap<object, Set<string>>();
  const seen = (o: unknown, prop: string): void => { if (isRecord(o)) { const s = handled.get(o) ?? new Set<string>(); s.add(prop); handled.set(o, s); } };

  // ── 処理フロー ──
  for (const f of input.flows) {
    const sec = `処理フロー ${f.meta.name ?? f.meta.id}`;
    const ref = { kind: "processFlow" as const, id: f.meta.id };
    seen(f.meta, "screenId");
    if (f.meta.screenId && !screenIds.has(f.meta.screenId)) warn(sec, `呼び出す画面「${f.meta.screenId}」がありません (meta.screenId)`, ref);
    const across = new Map<string, number>(); // 工程 id → それを持つアクションの数
    for (const a of f.actions ?? []) {
      const ids = new Map<string, number>();
      const responseIds = new Set((a.responses ?? []).map((r) => r.id));
      for (const s of stepsOf(a.steps as FlowStep[] | undefined)) {
        const x = s as Record<string, unknown>;
        const at = `アクション ${a.id ?? "?"} の工程 ${String(x.id ?? "?")}`;
        seen(x, "tableId"); seen(x, "targetScreenId");
        if (typeof x.id === "string") ids.set(x.id, (ids.get(x.id) ?? 0) + 1);
        if (x.kind === "dbAccess" && typeof x.tableId === "string" && x.tableId && !tableById.has(x.tableId)) warn(sec, `${at}: テーブル「${x.tableId}」がありません (tableId)`, ref);
        if (x.kind === "screenTransition" && typeof x.targetScreenId === "string" && x.targetScreenId && !screenIds.has(x.targetScreenId)) warn(sec, `${at}: 遷移先の画面「${x.targetScreenId}」がありません (targetScreenId)`, ref);
        if (x.kind === "commonProcess" && typeof x.refId === "string") {
          // 共通処理の呼び出しの契約: 渡す引数 (argumentMapping) と、呼び先の入力 (actions[].inputs) の突き合わせ。呼び先がなければ、参照の検査 (refId) が指摘する
          const callee = flowIds.get(x.refId);
          if (callee) {
            const acts = ((callee.actions ?? []) as unknown[]).filter(isRecord);
            const inputsOf = (act: Record<string, unknown>): Array<Record<string, unknown>> => (Array.isArray(act.inputs) ? act.inputs.filter(isRecord) : []);
            const known = new Set(acts.flatMap(inputsOf).map((i) => String(i.name ?? "")));
            const args = isRecord(x.argumentMapping) ? Object.keys(x.argumentMapping) : [];
            const calleeName = callee.meta.name ?? callee.meta.id;
            for (const k of args) if (!known.has(k)) warn(sec, `${at}: 呼び先の処理フロー「${calleeName}」の入力に、引数「${k}」がありません (argumentMapping)`, ref);
            // アクションが 1 つなら、必須の入力 (既定値がないもの) に引数が渡されているか。複数なら、どのアクションを呼ぶか決められないので見ない
            if (acts.length === 1) {
              for (const inp of inputsOf(acts[0])) if (inp.required === true && inp.defaultValue === undefined && typeof inp.name === "string" && !args.includes(inp.name)) warn(sec, `${at}: 呼び先の処理フロー「${calleeName}」の必須の入力「${inp.name}」に、引数が渡されていません (argumentMapping)`, ref);
            }
          }
        }
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
      // 結果の形 (outputBinding.shape) の宣言と、あとの工程での読み方
      const shapes = new Map<string, "one" | "list">();
      const allSteps = [...stepsOf(a.steps as FlowStep[] | undefined)];
      for (const s of allSteps) {
        const ob = (s as Record<string, unknown>).outputBinding;
        if (isRecord(ob) && typeof ob.name === "string" && (ob.shape === "one" || ob.shape === "list")) shapes.set(ob.name, ob.shape);
      }
      if (shapes.size) {
        for (const s of allSteps) {
          const text = ownText(s);
          const at = `アクション ${a.id ?? "?"} の工程 ${String((s as Record<string, unknown>).id ?? "?")}`;
          for (const [name, shape] of shapes) {
            if (shape === "list") {
              const m = new RegExp(`@${escapeRe(name)}\\.(?!(?:${ARRAY_MEMBERS})\\b)(\\w+)`).exec(text);
              if (m) warn(sec, `${at}: 変数「${name}」は一覧 (shape: list) と宣言されていますが、項目名で読んでいます (@${name}.${m[1]})。1 件なら shape を one に、一覧なら添字か繰り返しで読んでください`, ref);
            } else {
              const m = new RegExp(`@${escapeRe(name)}(?:\\[\\d+\\]|\\.(?:map|filter|forEach|reduce|some|every)\\b)`).exec(text);
              if (m) warn(sec, `${at}: 変数「${name}」は 1 件 (shape: one) と宣言されていますが、一覧として読んでいます (${m[0]})。一覧なら shape を list に、1 件なら添字・一覧の関数なしで読んでください`, ref);
            }
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
      seen(r, "tableId");
      if (it.binding?.kind === "tableColumn" && r?.tableId) {
        const t = tableById.get(r.tableId);
        if (!t) warn(sec, `項目「${it.id}」の結びつき先のテーブル「${r.tableId}」がありません (binding.ref.tableId)`, ref);
        else if (r.columnId && !(t.columns ?? []).some((c) => c.id === r.columnId || c.physicalName === r.columnId)) warn(sec, `項目「${it.id}」の結びつき先のカラム「${r.columnId}」が、テーブル「${t.name ?? t.id}」にありません (binding.ref.columnId)`, ref);
      }
      for (const ev of it.events ?? []) {
        seen(ev, "handlerFlowId");
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
      seen(c, "referencedTableId");
      if (c.kind !== "foreignKey" || c.noConstraint || !c.referencedTableId) continue;
      const rt = tableById.get(c.referencedTableId);
      const sec = `テーブル ${t.name ?? t.id}`;
      const ref = { kind: "table" as const, id: t.id };
      if (!rt) warn(sec, `外部キーの参照先のテーブル「${c.referencedTableId}」がありません (referencedTableId)`, ref);
      else for (const cid of c.referencedColumnIds ?? []) if (!(rt.columns ?? []).some((col) => col.id === cid || col.physicalName === cid)) warn(sec, `外部キーの参照先のカラム「${cid}」が、テーブル「${rt.name ?? rt.id}」にありません (referencedColumnIds)`, ref);
    }
  }

  // ── スキーマの参照の宣言 (x-ref-kind) がついた項目 ──
  // 項目名 → 種類 の表 (shared/src/analysis/refKinds.generated.ts) は、スキーマから作る。個別の検査が見ていない場所の参照も、同じ宣言で見つかる。
  // 設計の中の id (列・アクション・工程など) は、どの設計の中かを決める文脈が要るので、ここでは設計そのものを指すもの (テーブル・画面・処理フロー) だけ見る
  const exists: Record<string, { label: string; has: (id: string) => boolean }> = {
    table: { label: "テーブル", has: (id) => tableById.has(id) },
    screen: { label: "画面", has: (id) => screenIds.has(id) },
    processFlow: { label: "処理フロー", has: (id) => flowIds.has(id) },
  };
  const idLike = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !/[\s@{}$]/.test(v);
  // 同じ設計の中で、同じ項目が同じものを何度も指すとき (テストの前提データなど) は、1 件にまとめる (最初の場所 + ほか N か所)
  const scan = (root: unknown, base: string, sec: string, ref: DocIssue["ref"] | undefined): void => {
    const found = new Map<string, { at: string; label: string; id: string; k: string; n: number }>();
    const visit = (node: unknown, ptr: string): void => {
      if (Array.isArray(node)) { node.forEach((n, i) => visit(n, `${ptr}/${i}`)); return; }
      if (!isRecord(node)) return;
      for (const [k, v] of Object.entries(node)) {
        const kinds = REF_KINDS_BY_PROPERTY[k];
        const e = kinds && kinds.length === 1 ? exists[kinds[0]] : undefined;
        if (e && !handled.get(node)?.has(k)) {
          for (const id of Array.isArray(v) ? v : [v]) {
            if (!idLike(id) || e.has(id)) continue;
            const key = `${k}\u0000${id}`;
            const hit = found.get(key);
            if (hit) hit.n += 1; else found.set(key, { at: ptr || "/", label: e.label, id, k, n: 1 });
          }
        }
        if (v && typeof v === "object" && k !== "examples") visit(v, `${ptr}/${k}`);
      }
    };
    visit(root, base);
    for (const h of found.values()) warn(sec, `${h.at}: ${h.label}「${h.id}」がありません (${h.k})${h.n > 1 ? ` — ほか ${h.n - 1} か所` : ""}`, ref);
  };
  for (const f of input.flows) scan(f, "", `処理フロー ${f.meta.name ?? f.meta.id}`, { kind: "processFlow", id: f.meta.id });
  for (const s of input.screens) scan(s, "", `画面 ${s.name ?? s.id}`, { kind: "screen", id: s.id });
  for (const t of input.tables) scan(t, "", `テーブル ${t.name ?? t.id}`, { kind: "table", id: t.id });
  for (const b of input.businessFlows ?? []) scan(b, "", `業務フロー ${(b as { name?: string; id?: string }).name ?? (b as { id?: string }).id ?? ""}`, { kind: "businessFlow", id: String((b as { id?: string }).id ?? "") });
  for (const r of input.reports ?? []) scan(r, "", `帳票 ${(r as { name?: string; id?: string }).name ?? (r as { id?: string }).id ?? ""}`, { kind: "report", id: String((r as { id?: string }).id ?? "") });
  scan(input.transitions ?? [], "/transitions", "画面遷移", undefined);

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
