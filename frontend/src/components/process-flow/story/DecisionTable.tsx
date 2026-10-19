/**
 * 判定表 (「流れ」表示): 分岐の条件を「条件の行 × 道の列」の表で見る・直す。
 * 見る: ○ 成り立つ / × 成り立たない / － 関係しない。下に、見落としの指摘 (先に成り立つ道に隠れる道・どの道にも入らない組み合わせ)。
 * 直す (編集中): マスのクリックで ○ → × → － と切り替え。条件の行を足す・直す・消す。「または」の列と、道を足す。
 * 仕様: docs/spec/process-flow-story-view.md
 */
import { useMemo, useState } from "react";
import { returnStatus } from "@harmony/shared";
import { isPlainEnter } from "../../../utils/imeKeys";
import { clauseProblem, exprToValue, parseCondition, undefinedRefs, varCandidates, type Clause } from "./conditionBuilder";
import { expressionSegments } from "./expressionText";
import { ClauseFields } from "./StoryEditors";
import { CondText } from "./StoryParts";
import { StoryPopover } from "./StoryPopover";
import { addArm } from "./storyEdit";
import {
  armsEmptiedByRemoving, atomOf, buildDecisionModel, columnName, removeDtRow, replaceDtRow, rowFromAtom, setDtCell,
  type DecisionModel, type DtCell, type DtColumn, type DtRow, type DtRowSpec,
} from "./storyDecision";
import { stepHeadline, type Loose } from "./storyModel";
import { composeClause } from "./conditionBuilder";
import { useStoryUi } from "./storyUi";

const GLYPH: Record<DtCell, string> = { yes: "○", no: "×", any: "－" };
const NEXT: Record<DtCell, DtCell> = { any: "yes", yes: "no", no: "any" };
const WORD: Record<DtCell, string> = { yes: "成り立つ", no: "成り立たない", any: "関係しない" };

/** 道の中身の、ひと言 (最初の工程。返すなら状態コードと応答の説明) */
function outcomeOf(c: DtColumn, ui: ReturnType<typeof useStoryUi>): { text: string; tone: "ok" | "err" | "plain" } {
  if (c.implicit) return { text: "次の工程へ進む", tone: "plain" };
  const first = c.steps[0];
  if (!first) return { text: "（何もしない）", tone: "plain" };
  const more = c.steps.length > 1 ? ` ほか ${c.steps.length - 1} 工程` : "";
  if (first.kind === "return") {
    const status = returnStatus(first, ui.ctx.action);
    const resp = ui.ctx.action.responses?.find((r) => r.id === first.responseId);
    return { text: `${status ?? ""} ${resp?.description ?? stepHeadline(first)}${more}`.trim(), tone: (status ?? 0) >= 400 ? "err" : "ok" };
  }
  return { text: `${stepHeadline(first)}${more}`, tone: "plain" };
}

/** 行の条件を、1 つ入れる・直す窓 */
function RowEditor({ anchor, initial, beforeStepId, onSubmit, onClose }: {
  anchor: HTMLElement | null;
  initial: DtRowSpec | null;
  beforeStepId: string;
  onSubmit: (spec: DtRowSpec) => void;
  onClose: () => void;
}) {
  const ui = useStoryUi();
  const cands = useMemo(() => varCandidates(ui.ctx.action, beforeStepId, ui.edit?.ambient ?? []), [ui.ctx.action, beforeStepId, ui.edit?.ambient]);
  const [clause, setClause] = useState<Clause>(() => initial?.clause ?? { subject: cands[0]?.ref ?? "@", op: "==", value: "" });
  const [raw, setRaw] = useState(initial !== null && !initial.clause);
  const [text, setText] = useState(initial ? (initial.clause ? composeClause(initial.clause) : initial.raw) : "");
  const [draft, setDraft] = useState(() => exprToValue(initial?.clause?.value ?? ""));
  const composed = raw ? text.trim() : composeClause(clause);
  const problem = raw ? (composed ? "" : "条件を入れてください") : clauseProblem(clause);
  const missing = undefinedRefs(composed, cands);
  const apply = () => {
    if (problem) return;
    // 式として書いた条件も、比較の形なら部品にする (行の見分けが同じになるように)
    onSubmit(rowFromAtom(atomOf(composed)));
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title={initial ? "この条件を直す" : "調べる条件を足す"} onClose={onClose} width={460}>
      {!raw && <ClauseFields index={90} clause={clause} cands={cands} heading="どの値を" draft={draft} onDraft={setDraft} onChange={(patch) => setClause((c) => ({ ...c, ...patch }))} />}
      <datalist id="pfs-valrefs">{cands.map((x) => <option key={x.ref} value={x.ref}>{x.label}</option>)}</datalist>
      {raw && <textarea className="pfs-field pfs-mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="条件の式" onKeyDown={(e) => { if (isPlainEnter(e) && !e.shiftKey) { e.preventDefault(); apply(); } }} />}
      <div className="pfs-preview" aria-live="polite">
        {composed ? <CondText segs={expressionSegments(composed)} /> : <span className="pfs-muted">（条件が空です）</span>}
        <code className="pfs-code-line">{composed}</code>
      </div>
      {problem && <p className="pfs-warn">{problem}</p>}
      {!problem && missing.length > 0 && <p className="pfs-warn">この位置より前では、まだ作られていない変数があります: {missing.map((m) => `@${m}`).join(", ")}。</p>}
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn is-left" onClick={() => { if (raw) { const m = parseCondition(text); if (m && m.clauses.length === 1) { setClause(m.clauses[0]); setDraft(exprToValue(m.clauses[0].value)); setRaw(false); } } else { setText(composeClause(clause)); setRaw(true); } }} disabled={raw && !(parseCondition(text)?.clauses.length === 1)} title={raw && !(parseCondition(text)?.clauses.length === 1) ? "この式は、選びにできません" : undefined}>{raw ? "選びに戻す" : "式を直接書く"}</button>
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={Boolean(problem)} onClick={apply} data-testid="pfs-dt-row-apply">決める</button>
      </div>
    </StoryPopover>
  );
}

function RowHead({ row, index, model, editable, onEdit, onRemove }: { row: DtRow; index: number; model: DecisionModel; editable: boolean; onEdit: (el: HTMLElement) => void; onRemove: () => void }) {
  const emptied = editable ? armsEmptiedByRemoving(model, index) : [];
  return (
    <th scope="row" className="pfs-dt-rowhead">
      <CondText segs={row.segs} />
      {editable && (
        <span className="pfs-dt-rowacts">
          <button type="button" className="pfs-mini" aria-label="この条件を直す" title="この条件を直す (すべての道に反映)" onClick={(e) => onEdit(e.currentTarget)}>直す</button>
          <button type="button" className="pfs-mini is-danger" aria-label="この条件の行を消す" disabled={emptied.length > 0} title={emptied.length > 0 ? `道 ${emptied.join("・")} の条件が空になるので、消せません` : "この条件の行を消す (すべての道から外す)"} onClick={onRemove}>×</button>
        </span>
      )}
    </th>
  );
}

export function DecisionTable({ step, guard, defaultOpen, onSelect }: { step: Loose; guard: boolean; defaultOpen?: boolean; onSelect?: (id: string) => void }) {
  const ui = useStoryUi();
  const edit = ui.edit;
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [pendingRows, setPendingRows] = useState<DtRowSpec[]>([]);
  const [pendingAlt, setPendingAlt] = useState<string | null>(null);
  const [rowPop, setRowPop] = useState<{ anchor: HTMLElement | null; row: DtRowSpec | null } | null>(null);
  const [live, setLive] = useState("");
  const label = ui.ctx.labels.full;
  const model = useMemo(() => buildDecisionModel(step, { implicitElse: guard, label }), [step, guard, label]);
  if (!model) return null;
  const rows: DtRow[] = [...model.rows];
  for (const p of pendingRows) if (!rows.some((r) => r.key === p.key)) rows.push({ ...p, segs: p.clause ? expressionSegments(composeClause(p.clause)) : expressionSegments(p.raw), negSegs: [] });
  const pendingKeys = new Set(pendingRows.map((p) => p.key));
  const editable = Boolean(edit);
  const warns = model.issues.filter((i) => i.level === "warn");
  const armCols = (armId: string) => model.columns.filter((c) => c.armId === armId);
  const colSpec = (r: DtRow): DtRowSpec => ({ key: r.key, clause: r.clause, raw: r.raw, negatable: r.negatable });

  const setCell = (c: DtColumn, r: DtRow, cell: DtCell) => {
    if (!edit || !c.armId) return;
    const spec = colSpec(r);
    edit.mutate((a) => { setDtCell(a.steps, step.id, c.armId!, c.altIndex, spec, cell); });
    setPendingRows((p) => p.filter((x) => x.key !== r.key));
    if (pendingAlt === c.armId) setPendingAlt(null);
    setLive(`${r.segs.map((s) => (s.k === "text" ? s.v : s.k === "code" ? s.v : s.raw)).join("")}、${columnName(c)}: ${WORD[cell]}`);
  };
  const cycle = (c: DtColumn, r: DtRow, cur: DtCell) => {
    let next = NEXT[cur];
    if (next === "no" && !r.negatable) next = "any";
    setCell(c, r, next);
  };

  return (
    <div className="pfs-dt-wrap" data-testid="pfs-dt-wrap">
      <button type="button" className="pfs-chip pfs-chip--rule pfs-chip-btn pfs-dt-toggle" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} data-testid="pfs-dt-toggle">
        {open ? "▾" : "▸"} 判定表で見る{warns.length > 0 && <span className="pfs-dt-warnbadge" title="見落としの指摘があります"> ⚠ {warns.length}</span>}
      </button>
      {open && (
        <div className="pfs-dt" role="region" aria-label="判定表" data-testid="pfs-dt" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="pfs-dt-scroll">
            <table className="pfs-dt-table">
              <caption className="pfs-dt-cap">上の道から順に調べて、最初に成り立った道に進みます。<b>○</b> 成り立つ / <b>×</b> 成り立たない / <b>－</b> 関係しない</caption>
              <thead>
                <tr>
                  <th scope="col" className="pfs-dt-corner">条件 ＼ 道</th>
                  {model.columns.map((c, ci) => (
                    <th key={ci} scope="col" className={`pfs-dt-colhead${c.isElse ? " is-else" : ""}${c.unparsed ? " is-raw" : ""}`}>
                      <b>{c.isElse ? (c.implicit ? "それ以外" : `それ以外 (${c.code})`) : c.altCount > 1 ? `${c.code} の ${c.altIndex + 1}` : c.code}</b>
                      {c.altCount > 1 && c.altIndex > 0 && <small> または</small>}
                      {c.label && <small className="pfs-muted"> {c.label}</small>}
                      {c.unparsed && <small className="pfs-dt-raw" title="表にできない条件は、道の枠で直します">{c.unparsed}</small>}
                      {editable && c.armId && c.altIndex === c.altCount - 1 && !c.unparsed && (
                        <button type="button" className="pfs-mini" title="この道に、「または」の列を足す" aria-label={`道 ${c.code} に または の列を足す`} onClick={() => setPendingAlt(pendingAlt === c.armId ? null : c.armId)}>＋または</button>
                      )}
                    </th>
                  ))}
                  {pendingAlt && <th scope="col" className="pfs-dt-colhead is-pending"><b>{model.columns.find((c) => c.armId === pendingAlt)?.code} の {armCols(pendingAlt).length + 1}</b><small> または (新しい列)</small></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={r.key}>
                    <RowHead row={r} index={ri} model={model} editable={editable}
                      onEdit={(el) => setRowPop({ anchor: el, row: colSpec(r) })}
                      onRemove={() => {
                        if (pendingKeys.has(r.key) && !model.rows.some((m) => m.key === r.key)) setPendingRows((p) => p.filter((x) => x.key !== r.key));
                        else edit?.mutate((a) => { removeDtRow(a.steps, step.id, colSpec(r)); });
                      }} />
                    {model.columns.map((c, ci) => {
                      const cell = c.cells[ri] ?? "any";
                      if (c.unparsed) return <td key={ci} className="pfs-dt-cell is-na" aria-label="表にできない条件">·</td>;
                      const cap = `${r.segs.map((s) => (s.k === "var" ? s.raw : s.k === "text" ? s.v : s.v)).join("")} — ${columnName(c)}: ${WORD[cell]}`;
                      if (!editable || !c.armId) return <td key={ci} className={`pfs-dt-cell is-${cell}`} title={cell === "no" ? `成り立たない: ${r.negSegs.map((s) => (s.k === "var" ? s.raw : s.v)).join("")}` : undefined}><span aria-label={WORD[cell]}>{GLYPH[cell]}</span></td>;
                      return (
                        <td key={ci} className={`pfs-dt-cell is-${cell}`}>
                          <button type="button" className="pfs-dt-btn" aria-label={`${cap}。押すと切り替え`} title={cell === "no" ? `成り立たない: ${r.negSegs.map((s) => (s.k === "var" ? s.raw : s.v)).join("")}` : "押すと ○ → × → － と切り替わります"} onClick={() => cycle(c, r, cell)} data-testid="pfs-dt-cell">{GLYPH[cell]}</button>
                        </td>
                      );
                    })}
                    {pendingAlt && (
                      <td className="pfs-dt-cell is-any is-pending">
                        <button type="button" className="pfs-dt-btn" aria-label={`${r.segs.map((s) => (s.k === "var" ? s.raw : s.v)).join("")} — 新しい列: 成り立つにする`} onClick={() => { const arm = armCols(pendingAlt); const last = arm[arm.length - 1]; setCell({ ...last, altIndex: arm.length }, r, "yes"); }}>－</button>
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="pfs-dt-empty" colSpan={model.columns.length + 1}>まだ調べる条件がありません。{editable ? "「＋ 条件の行を足す」から入れます。" : ""}</td></tr>}
                <tr className="pfs-dt-result">
                  <th scope="row" className="pfs-dt-rowhead">そのとき</th>
                  {model.columns.map((c, ci) => {
                    const o = outcomeOf(c, ui);
                    return (
                      <td key={ci} className={`pfs-dt-out is-${o.tone}`}>
                        {c.steps[0] && onSelect ? <button type="button" className="pfs-link" title="この道の最初の工程を選ぶ" onClick={() => onSelect(c.steps[0].id)}>{o.text}</button> : o.text}
                      </td>
                    );
                  })}
                  {pendingAlt && <td className="pfs-dt-out is-plain pfs-muted">（同じ道）</td>}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="visually-hidden" role="status" aria-live="polite">{live}</div>
          {editable && (
            <div className="pfs-dt-acts">
              <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => setRowPop({ anchor: e.currentTarget, row: null })} data-testid="pfs-dt-add-row">＋ 条件の行を足す</button>
              <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={() => edit?.mutate((a) => { addArm(a.steps, step.id, edit.flowIds()); })} data-testid="pfs-dt-add-arm">＋ 道 (列) を足す</button>
            </div>
          )}
          {model.issues.length > 0 && (
            <ul className="pfs-dt-issues" data-testid="pfs-dt-issues">
              {model.issues.map((i, k) => <li key={k} className={i.level === "warn" ? "is-warn" : "is-info"}><span aria-hidden="true">{i.level === "warn" ? "⚠" : "ⓘ"}</span> {i.text}</li>)}
            </ul>
          )}
          {rowPop && edit && (
            <RowEditor
              anchor={rowPop.anchor}
              initial={rowPop.row}
              beforeStepId={step.id}
              onClose={() => setRowPop(null)}
              onSubmit={(spec) => {
                const old = rowPop.row;
                if (!old) { setPendingRows((p) => (p.some((x) => x.key === spec.key) || model.rows.some((m) => m.key === spec.key) ? p : [...p, spec])); return; }
                if (pendingKeys.has(old.key) && !model.rows.some((m) => m.key === old.key)) { setPendingRows((p) => p.map((x) => (x.key === old.key ? spec : x))); return; }
                edit.mutate((a) => { replaceDtRow(a.steps, step.id, old, spec); });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
