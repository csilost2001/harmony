/**
 * 「流れ」表示の、工程の並び・行・枠。読む表示に、編集中だけ、その場で直す窓口 (書き換え・足す・動かす・消す) が付く。
 * 仕様: docs/spec/process-flow-story-view.md
 */
import { memo, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { kindLabel, returnStatus } from "@harmony/shared";
import type { Step } from "../../../types/v3";
import { showToast } from "../../../utils/toast";
import { captureNextAction, latestAction } from "./actionTracker";
import { DecisionTable } from "./DecisionTable";
import { expressionSegments } from "./expressionText";
import { parseDnf } from "./storyDecision";
import { InlineText } from "./InlineText";
import { BindingEditor, CollectionPicker, ConditionEditor, InsertMenu, MovePicker, OperationPicker, ResponsePicker, TablePicker, type CondTarget } from "./StoryEditors";
import { ApproversEditor, ExternalEditor, RulesEditor, SqlEditor } from "./StoryFieldEditors";
import { Chips, CondText } from "./StoryParts";
import {
  addArm, canMoveInto, ensureElse, ensureGroup, frameWord, moveStepBy, moveStepTo, patchStep, removeArm, removeStepById, setHeading, type ListAddr,
} from "./storyEdit";
import {
  childGroups, conditionSegments, countSteps, isGuardBranch, stepChips, stepCode, stepDigest, stepHeadline,
  type Chip, type ChildGroup, type Loose,
} from "./storyModel";
import type { ReviewedSteps } from "./useReviewedSteps";
import { useRowUi, type AutoEdit, type StoryEditApi } from "./storyUi";
import type { ValidationError } from "../../../utils/actionValidation";

export interface RowEnv {
  zoom: "overview" | "detail" | "impl";
  selected: ReadonlySet<string>;
  hl: ReadonlySet<string>;
  flashId: string | null;
  reviewed: ReviewedSteps;
  digests: ReadonlyMap<string, string>;
  /** 工程ごとの、検査の指摘 */
  problems: ReadonlyMap<string, readonly ValidationError[]>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  /** 工程を入れたあと (選択・光らせ・続けて開く欄) */
  onInserted: (items: Step[], templateKey: string, addr: ListAddr) => void;
  /** 入れた直後に、続けて開く欄 (その工程の行だけが読む) */
  autoEdit: AutoEdit | null;
}

/**
 * 行の描き直しを省く (React.memo の比べ方)。行が読む env は、その行の id について見るものだけ。
 * env の関数 (onSelect など) は、親が毎回同じ物を渡す (呼ぶときに最新の処理へ回す) ので、比べない。
 */
function envSliceEqual(a: RowEnv, b: RowEnv, id: string, digest: string): boolean {
  return a.zoom === b.zoom
    && a.selected.has(id) === b.selected.has(id)
    && a.hl.has(id) === b.hl.has(id)
    && (a.flashId === id) === (b.flashId === id)
    && sameProblemList(a.problems.get(id), b.problems.get(id))
    && a.reviewed.toggle === b.reviewed.toggle
    && a.reviewed.isReviewed(id, digest) === b.reviewed.isReviewed(id, digest)
    && a.reviewed.isStale(id, digest) === b.reviewed.isStale(id, digest)
    && (a.autoEdit?.stepId === id ? a.autoEdit : null) === (b.autoEdit?.stepId === id ? b.autoEdit : null)
    && a.digests.get(id) === b.digests.get(id);
}
const sameProblemList = (a: readonly ValidationError[] | undefined, b: readonly ValidationError[] | undefined): boolean => a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p.severity === b[i].severity && p.message === b[i].message));
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a === b || (a.size === b.size && [...a].every((x) => b.has(x)));
function sameProblems(a: RowEnv["problems"], b: RowEnv["problems"]): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, la] of a) {
    const lb = b.get(id);
    if (!lb || lb.length !== la.length || la.some((p, i) => p.severity !== lb[i].severity || p.message !== lb[i].message)) return false;
  }
  return true;
}
/** 枠 (判定・繰り返しなど、中に工程を持つもの) の比べ方: 工程が前と同じ参照なら、中身は同じ。env は、中のすべての行に効くものを比べる */
function nodePropsEqual(p: { step: Loose; num: string; env: RowEnv; topLevel: boolean }, n: { step: Loose; num: string; env: RowEnv; topLevel: boolean }): boolean {
  const a = p.env, b = n.env;
  return p.step === n.step && p.num === n.num && p.topLevel === n.topLevel
    && a.zoom === b.zoom && a.flashId === b.flashId && a.autoEdit === b.autoEdit && a.reviewed.revision === b.reviewed.revision
    && a.onSelect === b.onSelect && a.onOpen === b.onOpen && a.onInserted === b.onInserted
    && sameSet(a.selected, b.selected) && sameSet(a.hl, b.hl) && sameProblems(a.problems, b.problems);
}
function rowPropsEqual(p: { step: Loose; num: string; env: RowEnv; topLevel: boolean; inside?: number }, n: { step: Loose; num: string; env: RowEnv; topLevel: boolean; inside?: number }): boolean {
  if (p.step !== n.step || p.num !== n.num || p.topLevel !== n.topLevel || p.inside !== n.inside) return false;
  return envSliceEqual(p.env, n.env, n.step.id, n.env.digests.get(n.step.id) ?? stepDigest(n.step));
}

const KIND_TONE: Record<string, string> = {
  dbAccess: "db",
  branch: "cond",
  loop: "loop",
  loopContinue: "loop",
  loopBreak: "loop",
  transactionScope: "tx",
  externalSystem: "ext",
  workflow: "wf",
};

/** 条件が「式」か (tryCatch・更新 0 件・外部呼び出しの結果は、ここでは直せない。直すと、エラーコードなどの中身が消える) */
function isExprCond(cond: unknown): boolean {
  const k = (cond as { kind?: string } | undefined)?.kind;
  return k === undefined || k === "expression";
}

function rowKindLabel(step: Loose, status: number | undefined): { text: string; tone: string } {
  if (step.kind === "return") return { text: (status ?? 200) >= 400 ? "エラーで返す" : "返す", tone: (status ?? 200) >= 400 ? "err" : "ok" };
  if (step.kind === "branch") return { text: isGuardBranch(step) ? "ガード" : "判定", tone: isGuardBranch(step) ? "err" : "cond" };
  return { text: kindLabel(step), tone: KIND_TONE[step.kind] ?? "plain" };
}

const DRAG_TYPE = "application/x-pfs-step";

// ─── 並びと、足す場所 ───────────────────────────────────

type StepListProps = { steps: readonly Loose[]; addr: ListAddr; numPrefix: string; startIndex: number; env: RowEnv };
/** 並びの比べ方: 工程が (参照で) 同じ並び・同じ場所・env の全体に効く部分が同じなら、描き直さない */
function stepListEqual(p: StepListProps, n: StepListProps): boolean {
  if (p.numPrefix !== n.numPrefix || p.startIndex !== n.startIndex || p.addr.ownerId !== n.addr.ownerId || p.addr.key !== n.addr.key) return false;
  if (p.steps.length !== n.steps.length || p.steps.some((s, i) => s !== n.steps[i])) return false;
  const a = p.env, b = n.env;
  return a.zoom === b.zoom && a.flashId === b.flashId && a.autoEdit === b.autoEdit && a.reviewed.revision === b.reviewed.revision
    && a.onSelect === b.onSelect && a.onOpen === b.onOpen && a.onInserted === b.onInserted
    && sameSet(a.selected, b.selected) && sameSet(a.hl, b.hl) && sameProblems(a.problems, b.problems);
}

export const StepList = memo(StepListImpl, stepListEqual);

function StepListImpl({ steps, addr, numPrefix, startIndex, env }: StepListProps) {
  return (
    <>
      {steps.map((s, i) => (
        <div key={s.id}>
          <Gap addr={addr} index={startIndex + i} env={env} />
          <StepNode step={s} num={`${numPrefix}${startIndex + i + 1}`} env={env} topLevel={addr.ownerId === null} />
        </div>
      ))}
      <Gap addr={addr} index={startIndex + steps.length} always={steps.length === 0} env={env} />
    </>
  );
}

const Gap = memo(GapImpl, (p, n) => p.addr.ownerId === n.addr.ownerId && p.addr.key === n.addr.key && p.index === n.index && p.always === n.always && p.env?.onInserted === n.env?.onInserted);

function GapImpl({ addr, index, always, env }: { addr: ListAddr; index: number; always?: boolean; env?: RowEnv }) {
  const ui = useRowUi();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const edit = ui.edit;
  if (!edit) return null;
  return (
    <div
      className={`pfs-gap${always ? " is-always" : ""}${over ? " is-over" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        // 動かせるかは、先に (更新の外で) 確かめる。通知を、更新の関数の中で出さないため
        if (!canMoveInto(ui.getAction().steps as unknown as Step[], id, addr.ownerId)) { showToast("自分の中へは動かせません", "info"); return; }
        edit.mutate((a) => { moveStepTo(a.steps, id, addr, index); });
      }}
    >
      <button ref={setAnchor} type="button" className="pfs-gap-btn" aria-label={`${frameWord(addr.key)} の ${index + 1} 番目の位置に工程を足す`} onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid="pfs-gap-add">
        ＋ {always ? "工程を足す" : "ここに追加"}
      </button>
      {open && env && (
        <InsertMenu anchor={anchor} addr={addr} index={index} onClose={() => setOpen(false)} onInserted={env.onInserted} />
      )}
    </div>
  );
}

// ─── 行の右の操作 ───────────────────────────────────────

function RunIfLine({ step, onEdit }: { step: Loose; onEdit?: (el: HTMLElement) => void }) {
  const runIf = typeof step.runIf === "string" ? step.runIf : "";
  if (!runIf) return null;
  const body = <>↳ <CondText segs={expressionSegments(runIf)} plain={Boolean(onEdit)} /> のときだけ</>;
  if (!onEdit) return <span className="pfs-runif" title={runIf}>{body}</span>;
  return <button type="button" className="pfs-runif pfs-runif--btn" title={`${runIf} — クリックで直す`} onClick={(e) => { e.stopPropagation(); onEdit(e.currentTarget); }}>{body}</button>;
}

function RowActions({ step, env, topLevel }: { step: Loose; env: RowEnv; topLevel: boolean }) {
  const ui = useRowUi();
  const edit = ui.edit;
  const digest = env.digests.get(step.id) ?? stepDigest(step);
  const done = env.reviewed.isReviewed(step.id, digest);
  const stale = env.reviewed.isStale(step.id, digest);
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  return (
    <span className="pfs-acts">
      {stale && <span className="pfs-stale" title="確認したあとに、この工程が変わりました">変更あり</span>}
      {edit && (
        <>
          <button type="button" className="pfs-mini" title="1 つ上へ (Alt+↑)" aria-label="1 つ上へ" onClick={(e) => { e.stopPropagation(); edit.mutate((a) => { moveStepBy(a.steps, step.id, -1); }); }} data-testid="pfs-up">↑</button>
          <button type="button" className="pfs-mini" title="1 つ下へ (Alt+↓)" aria-label="1 つ下へ" onClick={(e) => { e.stopPropagation(); edit.mutate((a) => { moveStepBy(a.steps, step.id, 1); }); }} data-testid="pfs-down">↓</button>
          <button type="button" className="pfs-mini" title="別の場所 (道・繰り返しの中など) へ移す" aria-label="別の場所へ移す" onClick={(e) => { e.stopPropagation(); setMoveAnchor(e.currentTarget); }} data-testid="pfs-move">移す</button>
          {topLevel && !step.heading && (
            <button type="button" className="pfs-mini" title="ここから新しい見出しを始める" aria-label="ここから見出しを始める" onClick={(e) => { e.stopPropagation(); edit.mutate((a) => { setHeading(a.steps, step.id, "新しい区切り"); }); }} data-testid="pfs-add-heading">見出し</button>
          )}
          <button type="button" className="pfs-mini is-danger" title="この工程を消す (Ctrl+Z で戻せます)" aria-label="この工程を消す" onClick={(e) => { e.stopPropagation(); removeWithToast(edit, step.id); }} data-testid="pfs-delete">×</button>
        </>
      )}
      <button
        type="button"
        className="pfs-check"
        aria-pressed={done}
        title={done ? "確認済み (クリックで外す)" : "確認済みにする"}
        aria-label={done ? "確認済みを外す" : "確認済みにする"}
        onClick={(e) => { e.stopPropagation(); env.reviewed.toggle(step.id, digest); }}
        data-testid="pfs-check"
      >
        ✓
      </button>
      {moveAnchor && <MovePicker anchor={moveAnchor} stepId={step.id} onClose={() => setMoveAnchor(null)} />}
      <button type="button" className="pfs-open" title="カードで開いて、細かく編集する" aria-label="カードで開く" onClick={(e) => { e.stopPropagation(); env.onOpen(step.id); }}>
        <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
      </button>
    </span>
  );
}

function removeWithToast(edit: StoryEditApi, id: string): void {
  // 消した直後の版を覚え、「元に戻す」は、いまの版がそれと同じときだけ効かせる
  // (そのあとに、Ctrl+Z・ほかの表示での編集・AI の反映があれば、それを戻してしまうため)
  let after: unknown = null;
  captureNextAction((a) => { after = a; });
  edit.mutate((a) => { removeStepById(a.steps, id); });
  const undo = edit.undo ? () => {
    if (after === null || latestAction() !== after) { showToast("そのあとに別の操作をしたので、ここからは戻せません (Ctrl+Z で順に戻せます)", "info"); return; }
    edit.undo?.();
  } : undefined;
  showToast("工程を消しました (Ctrl+Z で戻せます)", "info", undo ? { undo } : {});
}

/** 行にフォーカスがあるとき: Enter で選ぶ、Shift+Enter でカードで開く。編集中は、Alt+↑↓ で動かし、Delete で消す */
function rowKey(e: ReactKeyboardEvent, id: string, env: RowEnv, edit: ReturnType<typeof useRowUi>["edit"]): void {
  if (e.target !== e.currentTarget) return;
  if (edit && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    edit.mutate((a) => { moveStepBy(a.steps, id, e.key === "ArrowUp" ? -1 : 1); });
    return;
  }
  if (edit && e.key === "Delete") {
    e.preventDefault();
    removeWithToast(edit, id);
    return;
  }
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (e.shiftKey) env.onOpen(id);
  else env.onSelect(id);
}

function rowClass(step: Loose, env: RowEnv, extra = ""): string {
  return `pfs-row${extra ? ` ${extra}` : ""}${env.selected.has(step.id) ? " is-selected" : ""}${env.hl.has(step.id) ? " is-hl" : ""}${env.flashId === step.id ? " is-flash" : ""}`;
}

/** ドラッグの持ち手 (編集中だけ)。キーボードでは、Alt+↑↓ または ↑↓ ボタン */
function DragHandle({ id }: { id: string }) {
  const ui = useRowUi();
  if (!ui.edit) return null;
  return (
    <span
      className="pfs-handle"
      draggable
      title="ドラッグで動かす (キーボードは Alt+↑↓)"
      aria-hidden="true"
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "move"; }}
    >
      ⠿
    </span>
  );
}

// ─── 直す窓の状態 ───────────────────────────────────────

type PopState =
  | { kind: "table" | "operation" | "binding" | "response" | "ngResponse" | "collection" | "rules" | "sql" | "approvers" | "external"; anchor: HTMLElement | null }
  | { kind: "cond"; anchor: HTMLElement | null; target: CondTarget; initial: string; beforeStepId: string };

/** 工程の行で使う、直す窓の出し入れ。挿入の直後は、続けて開く窓を最初から開く (autoEdit) */
function usePops(step: Loose, autoEdit: AutoEdit | null) {
  const auto = autoEdit && autoEdit.stepId === step.id ? autoEdit : null;
  const [pop, setPop] = useState<PopState | null>(() => (auto ? initialPop(auto, step) : null));
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return { pop: pop ? { ...pop, anchor: pop.anchor ?? anchorEl } : null, setPop, setAnchorEl, autoDesc: auto?.what === "desc" };
}

function initialPop(auto: AutoEdit, step: Loose): PopState | null {
  if (auto.what === "table") return { kind: "table", anchor: null };
  if (auto.what === "response") return { kind: "response", anchor: null };
  if (auto.what === "cond" && auto.armId) return { kind: "cond", anchor: null, target: { kind: "arm", ownerId: step.id, armId: auto.armId }, initial: "", beforeStepId: step.id };
  return null;
}

function chipEditHandler(setPop: (p: PopState | null) => void) {
  return (chip: Chip, el: HTMLElement) => {
    if (chip.edit) setPop({ kind: chip.edit, anchor: el });
  };
}

function StepPops({ step, pop, setPop }: { step: Loose; pop: PopState | null; setPop: (p: PopState | null) => void }) {
  if (!pop) return null;
  const close = () => setPop(null);
  const ob = (step.outputBinding ?? {}) as { name?: string; label?: string };
  switch (pop.kind) {
    case "table": return <TablePicker anchor={pop.anchor} stepId={step.id} current={String(step.tableId ?? "")} onClose={close} />;
    case "operation": return <OperationPicker anchor={pop.anchor} stepId={step.id} current={String(step.operation ?? "SELECT")} onClose={close} />;
    case "binding": return <BindingEditor anchor={pop.anchor} stepId={step.id} name={ob.name ?? ""} label={ob.label ?? ""} onClose={close} />;
    case "response": return <ResponsePicker anchor={pop.anchor} stepId={step.id} current={String(step.responseId ?? "")} field="responseId" onClose={close} />;
    case "ngResponse": return <ResponsePicker anchor={pop.anchor} stepId={step.id} current={String((step.inlineBranch as { ngResponseId?: string } | undefined)?.ngResponseId ?? "")} field="ngResponseId" onClose={close} />;
    case "collection": return <CollectionPicker anchor={pop.anchor} stepId={step.id} current={String(step.collectionSource ?? "")} onClose={close} />;
    case "rules": return <RulesEditor anchor={pop.anchor} stepId={step.id} onClose={close} />;
    case "sql": return <SqlEditor anchor={pop.anchor} stepId={step.id} onClose={close} />;
    case "approvers": return <ApproversEditor anchor={pop.anchor} stepId={step.id} onClose={close} />;
    case "external": return <ExternalEditor anchor={pop.anchor} stepId={step.id} onClose={close} />;
    case "cond": return <ConditionEditor anchor={pop.anchor} target={pop.target} initial={pop.initial} beforeStepId={pop.beforeStepId} onClose={close} />;
    default: return null;
  }
}

/** 結果の変数を、あとから足せる種類 */
const CAN_BIND = new Set(["dbAccess", "compute", "externalSystem", "transactionScope", "commonProcess", "componentCall"]);

/** 足せる枠 (まだ無い、承認の結果・確定 / 取り消しのあと・入力エラーの道) */
function missingGroups(step: Loose): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const has = (k: string) => Array.isArray(step[k]);
  if (step.kind === "workflow") {
    if (!has("onApproved")) out.push({ key: "approved", label: "承認されたら" });
    if (!has("onRejected")) out.push({ key: "rejected", label: "却下されたら" });
    if (!has("onTimeout")) out.push({ key: "timeout", label: "期限が切れたら" });
  }
  if (step.kind === "transactionScope") {
    if (!has("onCommit")) out.push({ key: "commit", label: "確定したあと" });
    if (!has("onRollback")) out.push({ key: "rollback", label: "取り消したあと" });
  }
  if (step.kind === "validation") {
    const ib = (step.inlineBranch ?? {}) as { ng?: unknown[]; ngResponseId?: string };
    if (!Array.isArray(ib.ng) && !ib.ngResponseId) out.push({ key: "ng", label: "不正なときの処理" });
  }
  return out;
}

function AddGroups({ step }: { step: Loose }) {
  const ui = useRowUi();
  const edit = ui.edit;
  if (!edit) return null;
  const groups = missingGroups(step);
  const isBranch = step.kind === "branch";
  const hasElse = Boolean(step.elseBranch);
  if (groups.length === 0 && !isBranch) return null;
  return (
    <div className="pfs-addgroups">
      {groups.map((g) => (
        <button key={g.key} type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={() => edit.mutate((a) => { ensureGroup(a.steps, step.id, g.key); })}>＋ {g.label}</button>
      ))}
      {isBranch && (
        <>
          <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={() => edit.mutate((a) => { addArm(a.steps, step.id, edit.flowIds()); })} data-testid="pfs-add-arm">＋ 道 (条件) を足す</button>
          {!hasElse && <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={() => edit.mutate((a) => { ensureElse(a.steps, step.id, edit.flowIds()); })}>＋ それ以外</button>}
        </>
      )}
    </div>
  );
}

function Problems({ step, env }: { step: Loose; env: RowEnv }) {
  const list = env.problems.get(step.id);
  if (!list || list.length === 0) return null;
  const err = list.some((p) => p.severity === "error");
  return (
    <span className={`pfs-problem ${err ? "is-error" : "is-warn"}`} title={list.map((p) => p.message).join("\n")} data-testid="pfs-problem">
      {err ? "⚠" : "△"} {list.length} 件
    </span>
  );
}

// ─── 工程 ──────────────────────────────────────────────

const StepNode = memo(StepNodeImpl, nodePropsEqual);

function StepNodeImpl({ step, num, env, topLevel }: { step: Loose; num: string; env: RowEnv; topLevel: boolean }) {
  const ui = useRowUi();
  if (step.kind === "branch" && isGuardBranch(step)) return <GuardRow step={step} num={num} env={env} topLevel={topLevel} />;
  if (step.kind === "loopContinue" || step.kind === "loopBreak") {
    return (
      <div className="pfs-row pfs-row--quiet" data-step-id={step.id} tabIndex={0} onKeyDown={(e) => rowKey(e, step.id, env, ui.edit)}>
        <span className="pfs-num"><DragHandle id={step.id} /></span>
        <span className="pfs-kind pfs-kind--loop">{kindLabel(step)}</span>
        <div className="pfs-main">
          <div className="pfs-head">{step.kind === "loopContinue" ? "この行はここまで。次の行へ進む" : "繰り返しをここで終える"}</div>
          <RunIfLine step={step} />
        </div>
        {ui.edit ? <span className="pfs-acts"><button type="button" className="pfs-mini is-danger" aria-label="この工程を消す" onClick={() => removeWithToast(ui.edit!, step.id)}>×</button></span> : <span />}
      </div>
    );
  }
  const groups = childGroups(step, Boolean(ui.edit));
  const inside = groups.reduce((n, g) => n + countSteps(g.steps), 0);
  if (step.kind === "loop" || step.kind === "transactionScope") return <BoxNode step={step} num={num} env={env} groups={groups} inside={inside} topLevel={topLevel} />;
  return (
    <>
      <StepRow step={step} num={num} env={env} inside={inside} topLevel={topLevel} />
      {(groups.length > 0 || ui.edit) && (
        <div className="pfs-nest">
          {step.kind === "branch" && <DecisionTable step={step} guard={false} defaultOpen={env.autoEdit?.stepId === step.id && env.autoEdit.what === "decision"} onSelect={env.onSelect} />}
          {groups.map((g) => <GroupBlock key={g.key} owner={step} group={g} num={num} env={env} />)}
          <AddGroups step={step} />
        </div>
      )}
    </>
  );
}

function BoxNode({ step, num, env, groups, inside, topLevel }: { step: Loose; num: string; env: RowEnv; groups: ChildGroup[]; inside: number; topLevel: boolean }) {
  const ui = useRowUi();
  const isTx = step.kind === "transactionScope";
  const body = groups.find((g) => g.role === "body");
  const rest = groups.filter((g) => g !== body);
  const { pop, setPop, setAnchorEl, autoDesc } = usePops(step, env.autoEdit);
  const [bindEl, setBindEl] = useState<HTMLElement | null>(null);
  return (
    <div className={`pfs-box pfs-box--${isTx ? "tx" : "loop"}${env.hl.has(step.id) ? " is-hl" : ""}${env.flashId === step.id ? " is-flash" : ""}${env.selected.has(step.id) ? " is-selected" : ""}`} data-step-id={step.id}>
      <div className="pfs-box-head" ref={setAnchorEl} tabIndex={0} onKeyDown={(e) => rowKey(e, step.id, env, ui.edit)} onClick={() => env.onSelect(step.id)}>
        <span className="pfs-num">{num}<DragHandle id={step.id} /></span>
        <span className="pfs-box-mark" aria-hidden="true">{isTx ? "▼" : "↻"}</span>
        <div className="pfs-main">
          <div className="pfs-head">
            {isTx ? "ここから 1 まとまり — " : ""}
            <InlineText value={String(step.description ?? "")} editable={Boolean(ui.edit)} placeholder="（何をまとめるか書く）" autoEdit={autoDesc} onCommit={(v) => ui.edit?.mutate((a) => { patchStep(a.steps, step.id, { description: v }); })} />
            {!ui.edit && !step.description ? stepHeadline(step) : null}
            {isTx && <span className="pfs-muted"> どれか 1 つでも失敗したら、全部取り消す</span>}
            <span className="pfs-inside">（中の工程 {inside} 件）</span>
            <Problems step={step} env={env} />
          </div>
          <div className="pfs-sub"><RunIfLine step={step} onEdit={ui.edit ? (el) => setPop({ kind: "cond", anchor: el, target: { kind: "runIf", stepId: step.id }, initial: String(step.runIf ?? ""), beforeStepId: step.id }) : undefined} /></div>
          <Chips chips={stepChips(step, ui.ctx)} onEdit={chipEditHandler(setPop)} extra={<EditExtras step={step} setPop={setPop} bindRef={setBindEl} />} />
        </div>
        <RowActions step={step} env={env} topLevel={topLevel} />
      </div>
      <div className="pfs-nest">
        {body && <StepList steps={body.steps} addr={{ ownerId: step.id, key: "body" }} numPrefix={`${num}.`} startIndex={0} env={env} />}
      </div>
      {isTx && <div className="pfs-box-foot">▲ ここまで。すべて成功したら確定</div>}
      {rest.map((g) => <GroupBlock key={g.key} owner={step} group={g} num={num} env={env} />)}
      {ui.edit && <div className="pfs-nest"><AddGroups step={step} /></div>}
      <StepPops step={step} pop={pop && pop.kind === "binding" && !pop.anchor ? { ...pop, anchor: bindEl } : pop} setPop={setPop} />
    </div>
  );
}

/** 編集中だけ出る、「＋ 結果の変数」「＋ 実行条件」 */
function EditExtras({ step, setPop, bindRef }: { step: Loose; setPop: (p: PopState | null) => void; bindRef?: (el: HTMLElement | null) => void }) {
  const ui = useRowUi();
  if (!ui.edit) return null;
  const hasBinding = Boolean((step.outputBinding as { name?: string } | undefined)?.name);
  const hasRunIf = typeof step.runIf === "string" && step.runIf !== "";
  return (
    <>
      {step.kind === "dbAccess" && (
        <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "sql", anchor: e.currentTarget }); }} data-testid="pfs-edit-sql">{typeof step.sql === "string" && step.sql.trim() ? "SQL を直す" : "＋ SQL を書く"}</button>
      )}
      {step.kind === "validation" && (
        <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "rules", anchor: e.currentTarget }); }} data-testid="pfs-edit-rules">＋ ルールを足す・直す</button>
      )}
      {step.kind === "workflow" && (
        <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "approvers", anchor: e.currentTarget }); }} data-testid="pfs-edit-approvers">＋ 承認者・期限</button>
      )}
      {CAN_BIND.has(step.kind) && !hasBinding && (
        <button ref={bindRef} type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "binding", anchor: e.currentTarget }); }}>＋ 結果の変数</button>
      )}
      {!hasRunIf && (
        <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "cond", anchor: e.currentTarget, target: { kind: "runIf", stepId: step.id }, initial: "", beforeStepId: step.id }); }}>＋ 実行条件</button>
      )}
    </>
  );
}

function GroupBlock({ owner, group, num, env }: { owner: Loose; group: ChildGroup; num: string; env: RowEnv }) {
  const ui = useRowUi();
  const edit = ui.edit;
  const segs = group.role === "arm" ? conditionSegments(group.condition) : [];
  const lead = group.role === "arm" ? "もし" : group.role === "else" ? "それ以外" : group.label;
  const armId = group.role === "arm" ? group.key.slice(4) : "";
  const [pop, setPop] = useState<{ anchor: HTMLElement } | null>(null);
  const autoCond = env.autoEdit && env.autoEdit.stepId === owner.id && env.autoEdit.what === "cond" && env.autoEdit.armId === armId ? env.autoEdit : null;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [auto, setAuto] = useState(Boolean(autoCond));
  const initial = group.role === "arm" ? String((group.condition as { expression?: string } | undefined)?.expression ?? "") : "";
  const armCount = (owner.branches as unknown[] | undefined)?.length ?? 0;
  const addr: ListAddr = { ownerId: owner.id, key: group.key };
  const openCond = (el: HTMLElement | null) => { if (el) setPop({ anchor: el }); };
  return (
    <div className={`pfs-arm pfs-arm--${group.role}`} data-testid={`pfs-arm-${group.role}`} ref={setAnchorEl}>
      <div className="pfs-arm-head">
        <span className="pfs-arm-lab">{lead}</span>
        {group.role === "arm" && (edit && !isExprCond(group.condition) ? (
          <><CondText segs={segs} /> なら <span className="pfs-muted" title="エラー・更新件数・外部呼び出しの結果の条件は、「カードで開く」から直します">(この種類の条件は、カードで直します)</span></>
        ) : edit ? (
          <button type="button" className="pfs-cond-btn" title="クリックで、条件を直す" onClick={(e) => { e.stopPropagation(); openCond(e.currentTarget); }} data-testid="pfs-arm-cond">
            {initial.trim() ? <CondText segs={segs} plain /> : <span className="pfs-muted">（条件を決める）</span>} なら
          </button>
        ) : <><CondText segs={segs} /> なら</>)}
        {group.label && (group.role === "arm" || group.role === "else") && <small className="pfs-muted"> ({group.label})</small>}
        {group.steps.length === 0 && !edit && <span className="pfs-muted"> → 次の工程へ</span>}
        {edit && group.role === "arm" && armCount > 1 && (
          <button type="button" className="pfs-mini is-danger pfs-arm-del" aria-label="この道を消す" title="この道 (と中の工程) を消す (Ctrl+Z で戻せます)" onClick={() => edit.mutate((a) => { removeArm(a.steps, owner.id, armId); })}>×</button>
        )}
      </div>
      {(group.steps.length > 0 || edit) && (
        <div className="pfs-arm-body">
          <StepList steps={group.steps} addr={addr} numPrefix={group.code ? `${num}-${group.code}-` : `${num}.`} startIndex={0} env={env} />
        </div>
      )}
      {(pop || auto) && edit && (
        <ConditionEditor
          anchor={pop?.anchor ?? anchorEl}
          target={{ kind: "arm", ownerId: owner.id, armId }}
          initial={initial}
          beforeStepId={owner.id}
          onClose={() => { setPop(null); setAuto(false); }}
        />
      )}
    </div>
  );
}

// ─── 行 ────────────────────────────────────────────────

const StepRow = memo(StepRowImpl, rowPropsEqual);

function StepRowImpl({ step, num, env, inside, topLevel }: { step: Loose; num: string; env: RowEnv; inside: number; topLevel: boolean }) {
  const ui = useRowUi();
  const status = step.kind === "return" ? returnStatus(step, ui.ctx.action) : undefined;
  const k = rowKindLabel(step, status);
  const code = env.zoom === "impl" ? stepCode(step) : undefined;
  const { pop, setPop, setAnchorEl, autoDesc } = usePops(step, env.autoEdit);
  const editable = Boolean(ui.edit);
  const chips = stepChips(step, ui.ctx);
  const needsResponse = editable && step.kind === "return" && !chips.some((c) => c.edit === "response");
  return (
    <div
      className={rowClass(step, env)}
      ref={setAnchorEl}
      data-step-id={step.id}
      data-testid="pfs-row"
      tabIndex={0}
      onKeyDown={(e) => rowKey(e, step.id, env, ui.edit)}
      onClick={() => env.onSelect(step.id)}
      onDoubleClick={() => env.onOpen(step.id)}
    >
      <span className="pfs-num">{num}<DragHandle id={step.id} /></span>
      <span className={`pfs-kind pfs-kind--${k.tone}`}>{k.text}</span>
      <div className="pfs-main">
        <div className="pfs-head">
          {editable ? (
            <InlineText value={String(step.description ?? "")} editable placeholder="（何をするか書く）" autoEdit={autoDesc} onCommit={(v) => ui.edit?.mutate((a) => { patchStep(a.steps, step.id, { description: v }); })} />
          ) : stepHeadline(step)}
          {inside > 0 && <span className="pfs-inside">（中の工程 {inside} 件）</span>}
          <Problems step={step} env={env} />
        </div>
        <div className="pfs-sub">
          <RunIfLine step={step} onEdit={editable ? (el) => setPop({ kind: "cond", anchor: el, target: { kind: "runIf", stepId: step.id }, initial: String(step.runIf ?? ""), beforeStepId: step.id }) : undefined} />
          <Chips
            chips={chips}
            onEdit={chipEditHandler(setPop)}
            extra={
              <>
                {needsResponse && <button type="button" className="pfs-chip pfs-chip--dashed pfs-chip-btn" onClick={(e) => { e.stopPropagation(); setPop({ kind: "response", anchor: e.currentTarget }); }}>＋ 返す応答を選ぶ</button>}
                <EditExtras step={step} setPop={setPop} />
              </>
            }
          />
        </div>
        {code && <pre className="pfs-code">{code}</pre>}
      </div>
      <RowActions step={step} env={env} topLevel={topLevel} />
      <StepPops step={step} pop={pop} setPop={setPop} />
    </div>
  );
}

const GuardRow = memo(GuardRowImpl, rowPropsEqual);

function GuardRowImpl({ step, num, env, topLevel }: { step: Loose; num: string; env: RowEnv; topLevel: boolean }) {
  const ui = useRowUi();
  const arm = childGroups(step).find((g) => g.role === "arm");
  const ret = arm?.steps[0];
  const status = ret ? returnStatus(ret, ui.ctx.action) : undefined;
  const resp = ret ? ui.ctx.action.responses?.find((r) => r.id === ret.responseId) : undefined;
  const code = env.zoom === "impl" && ret ? stepCode(ret) : undefined;
  const editable = Boolean(ui.edit);
  const armId = arm ? arm.key.slice(4) : "";
  const initial = String((arm?.condition as { expression?: string } | undefined)?.expression ?? "");
  const auto = env.autoEdit && env.autoEdit.stepId === step.id && env.autoEdit.what === "cond" ? env.autoEdit : null;
  const [pop, setPop] = useState<{ kind: "cond" | "response"; anchor: HTMLElement | null } | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [autoOpen, setAutoOpen] = useState(Boolean(auto));
  const condSegs = conditionSegments(arm?.condition);
  // 条件が複合 (「かつ」「または」で、2 つ以上の条件) のガードは、判定表でも見られる
  const composite = useMemo(() => { const alts = parseDnf(initial); return Boolean(alts && (alts.length > 1 || alts.some((a) => a.length > 1))); }, [initial]);
  return (
    <div className={rowClass(step, env, "pfs-row--guard")} ref={setAnchorEl} data-step-id={step.id} data-testid="pfs-guard" tabIndex={0} onKeyDown={(e) => rowKey(e, step.id, env, ui.edit)} onClick={() => env.onSelect(step.id)} onDoubleClick={() => env.onOpen(step.id)}>
      {ret && <span data-step-id={ret.id} className="pfs-anchor" />}
      <span className="pfs-num">{num}<DragHandle id={step.id} /></span>
      <span className="pfs-kind pfs-kind--err">ガード</span>
      <div className="pfs-main">
        <div className="pfs-head">
          {editable && isExprCond(arm?.condition) ? (
            <button type="button" className="pfs-cond-btn" title="クリックで、条件を直す" onClick={(e) => { e.stopPropagation(); setPop({ kind: "cond", anchor: e.currentTarget }); }} data-testid="pfs-guard-cond">
              {initial.trim() ? <CondText segs={condSegs} plain /> : <span className="pfs-muted">（条件を決める）</span>}
            </button>
          ) : <CondText segs={condSegs} />}
          {" → "}
          {editable && ret ? (
            <button type="button" className="pfs-cond-btn" title="クリックで、返す応答を選ぶ" onClick={(e) => { e.stopPropagation(); setPop({ kind: "response", anchor: e.currentTarget }); }}>
              <b className={`pfs-status-text ${(status ?? 0) >= 400 ? "is-error" : ""}`}>{status ?? "応答を選ぶ"}</b> {resp?.description ?? ""}
            </button>
          ) : <><b className={`pfs-status-text ${(status ?? 0) >= 400 ? "is-error" : ""}`}>{status ?? ""}</b> {resp?.description ?? (ret ? stepHeadline(ret) : "")}</>}
          <Problems step={step} env={env} />
        </div>
        <div className="pfs-sub">
          {editable ? (
            <InlineText className="pfs-muted" value={String(step.description ?? "")} editable placeholder="（何を確かめるか書く）" onCommit={(v) => ui.edit?.mutate((a) => { patchStep(a.steps, step.id, { description: v }); })} />
          ) : <span className="pfs-muted">{stepHeadline(step)}</span>}
          <RunIfLine step={step} />
          {ret && <RunIfLine step={ret} />}
        </div>
        {editable && <AddGroups step={step} />}
        {composite && <DecisionTable step={step} guard defaultOpen={false} onSelect={env.onSelect} />}
        {code && <pre className="pfs-code">{code}</pre>}
      </div>
      <RowActions step={step} env={env} topLevel={topLevel} />
      {(pop?.kind === "cond" || autoOpen) && editable && arm && (
        <ConditionEditor anchor={pop?.anchor ?? anchorEl} target={{ kind: "arm", ownerId: step.id, armId }} initial={initial} beforeStepId={step.id} onClose={() => { setPop(null); setAutoOpen(false); }} />
      )}
      {pop?.kind === "response" && editable && ret && (
        <ResponsePicker anchor={pop.anchor} stepId={ret.id} current={String(ret.responseId ?? "")} field="responseId" onClose={() => setPop(null)} />
      )}
    </div>
  );
}
