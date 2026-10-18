/**
 * 「流れ」表示で、その場で直すための窓 (編集中だけ)。
 * 条件の組み立て・テーブルの選び・操作の選び・結果変数の呼び名・返す応答の選び・「ここに何をする？」(ひな型と AI への頼み)。
 */
import { isPlainEnter } from "../../../utils/imeKeys";
import { useMemo, useState } from "react";
import { STEP_KIND_LABELS } from "@harmony/shared";
import type { Step, StepKind } from "../../../types/v3";
import { isValidIdentifier, suggestIdentifier } from "../../../utils/identifierHints";
import { ALL_STEP_TYPES } from "../internal/stepCardConstants";
import { clauseProblem, composeCondition, exprToValue, OP_CHOICES, parseCondition, undefinedRefs, valueToExpr, varCandidates, type Clause, type CondModel, type CondOp } from "./conditionBuilder";
import { expressionSegments, parseVarRef } from "./expressionText";
import { CondText } from "./StoryParts";
import { StoryPopover } from "./StoryPopover";
import { insertSteps, patchOutputBinding, patchStep, renameVariable, setArmCondition, type ListAddr } from "./storyEdit";
import { variableFlow, type Loose } from "./storyModel";
import { buildKind, searchTemplates, type TemplateCtx } from "./storyTemplates";
import { useStoryUi } from "./storyUi";

interface PopProps {
  anchor: HTMLElement | null;
  onClose: () => void;
}

// ─── テーブルの選び ────────────────────────────────────

export function TablePicker({ anchor, stepId, current, onClose }: PopProps & { stepId: string; current: string }) {
  const ui = useStoryUi();
  const [q, setQ] = useState("");
  const tables = (ui.edit?.tables ?? []).filter((t) => `${t.name} ${t.physicalName} ${t.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (id: string) => {
    ui.edit?.mutate((a) => { patchStep(a.steps, stepId, { tableId: id }); });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="どのテーブルを使う？" onClose={onClose}>
      <input className="pfs-field" type="search" placeholder="テーブルを探す (名前・物理名)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (isPlainEnter(e) && tables[0]) pick(tables[0].id); }} aria-label="テーブルを探す" />
      <div className="pfs-pop-list" role="listbox" aria-label="テーブル">
        {tables.map((t) => (
          <button key={t.id} type="button" role="option" aria-selected={t.id === current} className={`pfs-opt${t.id === current ? " is-current" : ""}`} onClick={() => pick(t.id)}>
            <b>{t.name || t.physicalName}</b>
            <small>{t.physicalName}</small>
          </button>
        ))}
        {tables.length === 0 && <p className="pfs-note">該当するテーブルがありません。</p>}
      </div>
    </StoryPopover>
  );
}

// ─── 操作の選び ────────────────────────────────────────

const DB_OPS: Array<{ op: string; label: string }> = [
  { op: "SELECT", label: "検索 (SELECT)" },
  { op: "INSERT", label: "登録 (INSERT)" },
  { op: "UPDATE", label: "更新 (UPDATE)" },
  { op: "DELETE", label: "削除 (DELETE)" },
];

export function OperationPicker({ anchor, stepId, current, onClose }: PopProps & { stepId: string; current: string }) {
  const ui = useStoryUi();
  const ops = DB_OPS.some((o) => o.op === current) ? DB_OPS : [...DB_OPS, { op: current, label: current }];
  return (
    <StoryPopover anchor={anchor} title="何をする？" onClose={onClose} width={260}>
      <div className="pfs-pop-list" role="listbox" aria-label="DB の操作">
        {ops.map((o) => (
          <button key={o.op} type="button" role="option" aria-selected={o.op === current} className={`pfs-opt${o.op === current ? " is-current" : ""}`} onClick={() => { ui.edit?.mutate((a) => { patchStep(a.steps, stepId, { operation: o.op }); }); onClose(); }}>
            <b>{o.label}</b>
          </button>
        ))}
      </div>
    </StoryPopover>
  );
}

// ─── 結果変数の呼び名 ──────────────────────────────────

export function BindingEditor({ anchor, stepId, name, label, onClose }: PopProps & { stepId: string; name: string; label: string }) {
  const ui = useStoryUi();
  const [n, setN] = useState(name);
  const [l, setL] = useState(label);
  const taken = useMemo(() => new Set(variableFlow(ui.ctx.action).map((v) => v.name).filter((x) => x !== name)), [ui.ctx.action, name]);
  const problem = !n ? "名前を入れてください" : !isValidIdentifier(n, "camel") ? "英小文字で始まる英数字 (camelCase。例: customerId) にしてください" : taken.has(n) ? "同じ名前の変数が、すでにあります" : "";
  const suggestion = problem && n ? suggestIdentifier(n, "camel") : null;
  const apply = () => {
    if (problem) return;
    const renamed = n !== name;
    ui.edit?.mutate((a) => {
      patchOutputBinding(a.steps, stepId, { name: n, label: l.trim() });
      if (renamed) renameVariable(a.steps as unknown as Loose[], name, n);
    });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="結果の変数" onClose={onClose}>
      <label className="pfs-label">呼び名 (日本語。条件や変数の一覧に出る)</label>
      <input className="pfs-field" value={l} maxLength={40} placeholder="例: 取引先" onChange={(e) => setL(e.target.value)} aria-label="呼び名" />
      <label className="pfs-label">名前 (英字。式の中で使う)</label>
      <input className="pfs-field" value={n} placeholder="例: customer" onChange={(e) => setN(e.target.value)} aria-label="名前" onKeyDown={(e) => { if (isPlainEnter(e)) apply(); }} />
      {problem && <p className="pfs-warn">{problem}{suggestion && <> — <button type="button" className="pfs-link" onClick={() => setN(suggestion)}>「{suggestion}」にする</button></>}</p>}
      {n !== name && name && !problem && <p className="pfs-note">名前を変えると、この変数を使っている式 (条件・SQL など) の `@{name}` も、`@{n}` に直します。</p>}
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={Boolean(problem)} onClick={apply}>決める</button>
      </div>
    </StoryPopover>
  );
}

// ─── 返す応答の選び ────────────────────────────────────

export function ResponsePicker({ anchor, stepId, current, field, onClose }: PopProps & { stepId: string; current: string; field: "responseId" | "ngResponseId" }) {
  const ui = useStoryUi();
  const responses = ui.ctx.action.responses ?? [];
  const pick = (id: string) => {
    ui.edit?.mutate((a) => {
      if (field === "responseId") patchStep(a.steps, stepId, { responseId: id });
      else {
        const target = findDeep(a.steps as unknown as Loose[], stepId);
        if (target) {
          const ib = (target.inlineBranch ?? { ok: [], ng: [] }) as Record<string, unknown>;
          ib.ngResponseId = id;
          target.inlineBranch = ib;
        }
      }
    });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="どの応答を返す？" onClose={onClose}>
      <div className="pfs-pop-list" role="listbox" aria-label="返す応答">
        {responses.map((r) => (
          <button key={r.id} type="button" role="option" aria-selected={r.id === current} className={`pfs-opt${r.id === current ? " is-current" : ""}`} onClick={() => pick(r.id)}>
            <b>{r.status}</b> <span>{r.description || r.id}</span>
            <small>{r.id}</small>
          </button>
        ))}
        {responses.length === 0 && <p className="pfs-note">このアクションに、応答の定義がありません。カードの「HTTP 契約」で、応答を足してください。</p>}
      </div>
    </StoryPopover>
  );
}

function findDeep(steps: Loose[], id: string): Loose | null {
  for (const s of steps) {
    if (s.id === id) return s;
    for (const k of ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"]) {
      const l = s[k];
      if (Array.isArray(l)) { const h = findDeep(l as Loose[], id); if (h) return h; }
    }
    if (Array.isArray(s.branches)) for (const b of s.branches as Array<{ steps?: Loose[] }>) { const h = findDeep(b.steps ?? [], id); if (h) return h; }
    const e = s.elseBranch as { steps?: Loose[] } | undefined;
    if (e?.steps) { const h = findDeep(e.steps, id); if (h) return h; }
  }
  return null;
}

// ─── 条件の組み立て ────────────────────────────────────

export type CondTarget = { kind: "arm"; ownerId: string; armId: string } | { kind: "runIf"; stepId: string };

interface SubjectParts { root: string; prop: string }

function splitSubject(subject: string): SubjectParts {
  const v = parseVarRef(subject);
  if (!v) return { root: subject, prop: "" };
  const rootText = `@${subject.slice(1).split(/[.[]/)[0]}`;
  // `@var.action.x.y` のような形は、そのまま root に残す (候補に無ければ「不明」として出す)
  if (subject.startsWith("@var.")) return { root: `@${v.name}`, prop: v.path.join(".").replace(/\.\[/g, "[") };
  return { root: rootText, prop: subject.slice(rootText.length).replace(/^\./, "") };
}

function joinSubject(root: string, prop: string): string {
  if (!prop) return root;
  return prop.startsWith("[") ? `${root}${prop}` : `${root}.${prop}`;
}

export function ConditionEditor({ anchor, target, initial, beforeStepId, onClose }: PopProps & { target: CondTarget; initial: string; beforeStepId: string; }) {
  const ui = useStoryUi();
  const cands = useMemo(() => varCandidates(ui.ctx.action, beforeStepId, ui.edit?.ambient ?? []), [ui.ctx.action, beforeStepId, ui.edit?.ambient]);
  const parsed = useMemo(() => parseCondition(initial), [initial]);
  const [raw, setRaw] = useState(parsed === null);
  const [model, setModel] = useState<CondModel>(() => parsed && parsed.clauses.length > 0 ? parsed : { join: "&&", clauses: [{ subject: cands[0]?.ref ?? "@", op: "==", value: "" }] });
  const [text, setText] = useState(initial);
  const composed = raw ? text : composeCondition({ ...model, clauses: model.clauses.map((c) => ({ ...c, value: c.value })) });
  const setClause = (i: number, patch: Partial<Clause>) => setModel((m) => ({ ...m, clauses: m.clauses.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const problem = raw ? (target.kind === "arm" && !composed.trim() ? "条件を入れてください" : "") : model.clauses.map(clauseProblem).find(Boolean) ?? "";
  const missing = undefinedRefs(composed, cands);
  const apply = () => {
    if (problem) return;
    const expr = composed.trim();
    ui.edit?.mutate((a) => {
      if (target.kind === "arm") setArmCondition(a.steps, target.ownerId, target.armId, expr);
      else patchStep(a.steps, target.stepId, { runIf: expr || undefined });
    });
    onClose();
  };
  const title = target.kind === "arm" ? "この道に進む条件" : "この工程を実行する条件 (実行条件)";
  return (
    <StoryPopover anchor={anchor} title={title} onClose={onClose} width={460}>
      {!raw && (
        <>
          {parsed === null && null}
          {model.clauses.map((c, i) => {
            const sp = splitSubject(c.subject);
            const cand = cands.find((x) => x.ref === sp.root);
            const needsValue = OP_CHOICES.find((o) => o.op === c.op)?.needsValue ?? true;
            return (
              <div key={i} className="pfs-clause" data-testid="pfs-clause">
                <label className="pfs-label">{i === 0 ? "どの値を" : model.join === "&&" ? "かつ、どの値を" : "または、どの値を"}</label>
                <div className="pfs-row-fields">
                  <select className="pfs-field" aria-label="値の元" value={sp.root} onChange={(e) => setClause(i, { subject: joinSubject(e.target.value, "") })}>
                    {!cand && <option value={sp.root}>{sp.root} (見つかりません)</option>}
                    {cands.map((x) => <option key={x.ref} value={x.ref}>{x.label}{x.label !== x.ref.slice(1) ? ` (${x.ref})` : ""}</option>)}
                  </select>
                  <input className="pfs-field" aria-label="項目" list={`pfs-props-${i}`} placeholder={cand?.props.length ? "項目 (選ぶか、書く)" : "項目 (なければ空)"} value={sp.prop} onChange={(e) => setClause(i, { subject: joinSubject(sp.root, e.target.value.trim()) })} />
                  <datalist id={`pfs-props-${i}`}>{cand?.props.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}</datalist>
                </div>
                <label className="pfs-label">どうなら</label>
                <div className="pfs-row-fields">
                  <select className="pfs-field" aria-label="比べ方" value={c.op} onChange={(e) => setClause(i, { op: e.target.value as CondOp })}>
                    {OP_CHOICES.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                  </select>
                  {needsValue && (
                    <input className="pfs-field" aria-label="比べる値" list="pfs-valrefs" placeholder="値 (例: 0 / prepaid / @credit.limit)" value={exprToValue(c.value)} onChange={(e) => setClause(i, { value: valueToExpr(e.target.value) })} />
                  )}
                  {model.clauses.length > 1 && <button type="button" className="pfs-btn" aria-label="この条件を外す" onClick={() => setModel((m) => ({ ...m, clauses: m.clauses.filter((_, k) => k !== i) }))}>×</button>}
                </div>
              </div>
            );
          })}
          <datalist id="pfs-valrefs">{cands.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</datalist>
          <div className="pfs-pop-btns is-left">
            <button type="button" className="pfs-btn" onClick={() => setModel((m) => ({ ...m, clauses: [...m.clauses, { subject: cands[0]?.ref ?? "@", op: "==", value: "" }] }))}>＋ 条件を足す</button>
            {model.clauses.length > 1 && (
              <select className="pfs-field is-inline" aria-label="つなぎ方" value={model.join} onChange={(e) => setModel((m) => ({ ...m, join: e.target.value as "&&" | "||" }))}>
                <option value="&&">すべて満たす (かつ)</option>
                <option value="||">どれか満たす (または)</option>
              </select>
            )}
          </div>
        </>
      )}
      {raw && (
        <>
          <p className="pfs-note">{parsed === null ? "この式は、選びでは組み立てられません (括弧・関数など)。式を直接直せます。" : "式を直接書きます。"}</p>
          <textarea className="pfs-field pfs-mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="条件の式" />
        </>
      )}
      <div className="pfs-preview" aria-live="polite" data-testid="pfs-cond-preview">
        {composed.trim() ? <CondText segs={expressionSegments(composed)} /> : <span className="pfs-muted">（条件が空です）</span>}
        <code className="pfs-code-line">{composed}</code>
      </div>
      {problem && <p className="pfs-warn" data-testid="pfs-cond-problem">{problem}</p>}
      {!problem && missing.length > 0 && <p className="pfs-warn" data-testid="pfs-cond-missing">この位置より前では、まだ作られていない変数があります: {missing.map((m) => `@${m}`).join(", ")}。先に、その変数を作る工程を置いてください。</p>}
      <div className="pfs-pop-btns">
        {parsed !== null || !raw ? <button type="button" className="pfs-btn is-left" onClick={() => { if (raw) { const m = parseCondition(text); if (m && m.clauses.length) { setModel(m); setRaw(false); } } else { setText(composed); setRaw(true); } }}>{raw ? "選びに戻す" : "式を直接書く"}</button> : null}
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={Boolean(problem)} onClick={apply} data-testid="pfs-cond-apply">この条件にする</button>
      </div>
    </StoryPopover>
  );
}

// ─── 「ここに何をする？」 ───────────────────────────────

export interface InsertMenuProps extends PopProps {
  addr: ListAddr;
  index: number;
  /** 入れたあとに、続けて開く欄を決めるため */
  onInserted: (items: Step[], templateKey: string) => void;
}

export function InsertMenu({ anchor, addr, index, onClose, onInserted }: InsertMenuProps) {
  const ui = useStoryUi();
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [ask, setAsk] = useState("");
  const results = searchTemplates(q);
  const ctx = (): TemplateCtx => ({ ids: ui.edit?.flowIds() ?? new Set(), responses: ui.ctx.action.responses, usedVars: new Set(variableFlow(ui.ctx.action).map((v) => v.name)) });
  const place = (items: Step[], key: string) => {
    ui.edit?.mutate((a) => { insertSteps(a.steps, addr, index, items); });
    onInserted(items, key);
    onClose();
  };
  const pickTemplate = (key: string) => {
    const t = searchTemplates("").find((x) => x.key === key);
    if (t) place(t.build(ctx()), key);
  };
  const pickKind = (kind: StepKind) => place(buildKind(kind, ctx()), `kind:${kind}`);
  const submitAsk = () => {
    const text = ask.trim();
    if (!text || !ui.edit?.askAi) return;
    ui.edit.askAi(`処理フローの「${ui.ctx.action.name}」アクションに、次の内容の工程を追加してください: ${text}\n(追加する位置: ${addr.ownerId ? `工程 ${addr.ownerId} の「${addr.key}」の ${index + 1} 番目` : `最上位の ${index + 1} 番目`})`);
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="ここに何をする？" onClose={onClose} width={420}>
      <input
        className="pfs-field"
        type="search"
        placeholder="探す (例: 承認 / ガード / 繰り返し)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (isPlainEnter(e) && results[0]) pickTemplate(results[0].key); }}
        aria-label="何をするか探す"
        data-testid="pfs-insert-search"
      />
      <div className="pfs-pop-list" role="listbox" aria-label="置けるもの">
        {results.map((t) => (
          <button key={t.key} type="button" role="option" aria-selected="false" className="pfs-opt" onClick={() => pickTemplate(t.key)} data-testid={`pfs-template-${t.key}`}>
            <b>{t.label}</b>
            <small>{t.description}</small>
          </button>
        ))}
        {results.length === 0 && <p className="pfs-note">該当する型がありません。「ほかの種類」から選べます。</p>}
      </div>
      <button type="button" className="pfs-link" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "▾" : "▸"} ほかの種類 (すべての工程の種類)</button>
      {more && (
        <div className="pfs-kinds">
          {ALL_STEP_TYPES.map((k) => <button key={k} type="button" className="pfs-chip pfs-chip--rule pfs-chip-btn" onClick={() => pickKind(k)}>{STEP_KIND_LABELS[k] ?? k}</button>)}
        </div>
      )}
      {ui.edit?.askAi && (
        <div className="pfs-ask">
          <label className="pfs-label" htmlFor="pfs-ask-input">日本語で頼む (AI が下書きを作る。内容を確かめてから反映)</label>
          <div className="pfs-row-fields">
            <input id="pfs-ask-input" className="pfs-field" placeholder="例: 在庫が足りなければ 422 を返す" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (isPlainEnter(e)) submitAsk(); }} />
            <button type="button" className="pfs-btn" disabled={!ask.trim()} onClick={submitAsk}>頼む</button>
          </div>
        </div>
      )}
    </StoryPopover>
  );
}
