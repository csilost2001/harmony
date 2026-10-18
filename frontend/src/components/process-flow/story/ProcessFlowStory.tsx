/**
 * 処理フローの「流れ」表示 — AI が作った複雑な処理を、人が全体から詳細まで把握するための読む画面。
 *
 * - 入れ子をそのまま見せる (判定は「もし〜なら」の枠、繰り返しは囲み、トランザクションは帯)
 * - 「〜なら、ここで返す」だけの判定は、1 行のガードにする
 * - 条件は式ではなく言葉で (式は「実装」の細かさで出す)
 * - 概要 / 詳細 / 実装 の 3 段階の拡大縮小。見出しで区切って畳める
 * - 出口 (どう終わるか) の一覧と、変数の作る場所・使う場所
 * - 確認済み ✓ (確かめた人の手元の記録)
 *
 * 仕様: docs/spec/process-flow-story-view.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionDefinition } from "../../../types/v3";
import { kindLabel, returnStatus, type FlowContext } from "@harmony/shared";
import {
  asLooseList,
  buildVarLabels,
  childGroups,
  collectExits,
  conditionSegments,
  countSteps,
  isGuardBranch,
  reviewTargets,
  sectionsOf,
  stepChips,
  stepCode,
  stepDigest,
  stepHeadline,
  variableFlow,
  walkSteps,
  type ChildGroup,
  type Loose,
  type StoryCtx,
} from "./storyModel";
import { expressionSegments } from "./expressionText";
import { Chips, CondText } from "./StoryParts";
import { StoryUiProvider, useStoryUi } from "./storyUi";
import { useReviewedSteps } from "./useReviewedSteps";
import "../../../styles/processFlowStory.css";

type Zoom = "overview" | "detail" | "impl";
type Tab = "flow" | "exits" | "vars";

const ZOOM_KEY = "harmony.processFlow.storyZoom";
const ZOOMS: Array<{ key: Zoom; label: string; title: string }> = [
  { key: "overview", label: "概要", title: "見出しと 1 行だけ。入れ子は畳む" },
  { key: "detail", label: "詳細", title: "入れ子と条件まで" },
  { key: "impl", label: "実装", title: "SQL・式・変数の名前まで" },
];

function readZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    if (v === "overview" || v === "detail" || v === "impl") return v;
  } catch { /* storage 不可 */ }
  return "detail";
}

export interface ProcessFlowStoryProps {
  action: ActionDefinition;
  /** 確認済みの記録の置き場所を分けるための名前 (処理フローの uuid など) */
  reviewKey: string;
  ctx: FlowContext;
  selectedStepIds: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  /** カードで開く (編集) */
  onOpenStep: (stepId: string) => void;
}

interface RowEnv {
  zoom: Zoom;
  selected: ReadonlySet<string>;
  hl: ReadonlySet<string>;
  flashId: string | null;
  reviewed: ReturnType<typeof useReviewedSteps>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
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

function rowKindLabel(step: Loose, status: number | undefined): { text: string; tone: string } {
  if (step.kind === "return") return { text: (status ?? 200) >= 400 ? "エラーで返す" : "返す", tone: (status ?? 200) >= 400 ? "err" : "ok" };
  if (step.kind === "branch") return { text: isGuardBranch(step) ? "ガード" : "判定", tone: isGuardBranch(step) ? "err" : "cond" };
  return { text: kindLabel(step), tone: KIND_TONE[step.kind] ?? "plain" };
}

export function ProcessFlowStory({ action, reviewKey, ctx, selectedStepIds, onSelectStep, onOpenStep }: ProcessFlowStoryProps) {
  const [zoom, setZoom] = useState<Zoom>(readZoom);
  const [tab, setTab] = useState<Tab>("flow");
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [activeVar, setActiveVar] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const changeZoom = useCallback((z: Zoom) => {
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, z); } catch { /* storage 不可 */ }
  }, []);

  const steps = useMemo(() => asLooseList(action.steps), [action.steps]);
  const labels = useMemo(() => buildVarLabels(action), [action]);
  const storyCtx = useMemo<StoryCtx>(() => ({ flow: ctx, action, labels }), [ctx, action, labels]);
  const sections = useMemo(() => sectionsOf(steps), [steps]);
  const exits = useMemo(() => collectExits(action, labels), [action, labels]);
  const vars = useMemo(() => variableFlow(action, labels), [action, labels]);
  const targets = useMemo(() => reviewTargets(steps), [steps]);
  const digests = useMemo(() => new Map(targets.map((s) => [s.id, stepDigest(s)])), [targets]);
  const reviewed = useReviewedSteps(reviewKey);
  const reviewedCount = reviewed.countReviewed(digests);

  /** 文書の順 (上から) の工程 ID */
  const order = useMemo(() => {
    const ids: string[] = [];
    walkSteps(steps, (s) => { ids.push(s.id); });
    return ids;
  }, [steps]);

  const activeInfo = activeVar ? vars.find((v) => v.name === activeVar) ?? null : null;
  const hl = useMemo(() => new Set(activeInfo ? [...activeInfo.defIds, ...activeInfo.useIds] : []), [activeInfo]);
  const hlOrdered = useMemo(() => order.filter((id) => hl.has(id)), [order, hl]);

  const jumpTo = useCallback((stepId: string) => {
    setTab("flow");
    setCollapsed(new Set());
    setFlashId(stepId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const stepVar = useCallback((dir: 1 | -1) => {
    if (hlOrdered.length === 0) return;
    const cur = flashId ? hlOrdered.indexOf(flashId) : -1;
    const next = cur < 0 ? (dir === 1 ? 0 : hlOrdered.length - 1) : (cur + dir + hlOrdered.length) % hlOrdered.length;
    jumpTo(hlOrdered[next]);
  }, [hlOrdered, flashId, jumpTo]);

  const env: RowEnv = { zoom, selected: selectedStepIds, hl, flashId, reviewed, onSelect: onSelectStep, onOpen: onOpenStep };
  const ui = useMemo(() => ({ ctx: storyCtx, showNames: zoom === "impl", activeVar, setActiveVar }), [storyCtx, zoom, activeVar]);

  if (steps.length === 0) {
    return <div className="pfs-empty" data-testid="process-flow-story">工程がありません。「カード」の表示で、左のブロックから追加してください。</div>;
  }

  const hasHeadings = sections.some((s) => s.heading);

  return (
    <StoryUiProvider value={ui}>
      <div className={`pfs-root pfs-z-${zoom}`} ref={rootRef} data-testid="process-flow-story">
        <div className="pfs-toolbar">
          <div className="pfs-tabs" role="tablist" aria-label="流れの見方">
            <button type="button" role="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")} data-testid="pfs-tab-flow">流れ</button>
            <button type="button" role="tab" aria-selected={tab === "exits"} onClick={() => setTab("exits")} data-testid="pfs-tab-exits" title="この処理が終わるすべての出口と、そこへ行く条件">出口 ({exits.length})</button>
            <button type="button" role="tab" aria-selected={tab === "vars"} onClick={() => setTab("vars")} data-testid="pfs-tab-vars" title="途中で作られ、あとで使われる変数">変数 ({vars.length})</button>
          </div>
          {tab === "flow" && (
            <div className="pfs-zoom" role="group" aria-label="表示の細かさ">
              {ZOOMS.map((z) => (
                <button key={z.key} type="button" aria-pressed={zoom === z.key} title={z.title} onClick={() => changeZoom(z.key)} data-testid={`pfs-zoom-${z.key}`}>{z.label}</button>
              ))}
            </div>
          )}
          <div className="pfs-progress" title="人が 1 行ずつ確かめた数。確かめたあとに工程が変わると、印は外れます">
            <span data-testid="pfs-progress-text">確認済み {reviewedCount} / {targets.length}</span>
            <i><b style={{ width: `${targets.length ? (100 * reviewedCount) / targets.length : 0}%` }} /></i>
            {reviewedCount > 0 && <button type="button" className="pfs-link" onClick={reviewed.clear}>すべて外す</button>}
          </div>
        </div>

        {activeInfo && tab === "flow" && (
          <div className="pfs-varbar" data-testid="pfs-varbar">
            <span><b>{activeInfo.label}</b>{activeInfo.label !== activeInfo.name && <code>{activeInfo.name}</code>}</span>
            <span>作る {activeInfo.defIds.length} か所 / 使う {activeInfo.useIds.length} か所</span>
            <button type="button" onClick={() => stepVar(-1)} aria-label="前の場所へ">↑ 前</button>
            <button type="button" onClick={() => stepVar(1)} aria-label="次の場所へ">↓ 次</button>
            <button type="button" onClick={() => setActiveVar(null)}>解除</button>
          </div>
        )}

        {tab === "flow" && (
          <div className="pfs-flow">
            {sections.map((sec, si) => {
              const isCollapsed = collapsed.has(si);
              const body = (
                <StepList steps={sec.steps} numPrefix="" startIndex={sec.startIndex} env={env} />
              );
              if (!hasHeadings) return <div key={si}>{body}</div>;
              return (
                <section key={si} className={`pfs-section${isCollapsed ? " is-collapsed" : ""}`} data-testid="pfs-section">
                  <header
                    onClick={() => setCollapsed((cur) => { const n = new Set(cur); if (n.has(si)) n.delete(si); else n.add(si); return n; })}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                  >
                    <span className="pfs-section-no">{sec.heading ? sections.slice(0, si + 1).filter((x) => x.heading).length : "•"}</span>
                    <h3>{sec.heading ?? "はじめに"}</h3>
                    <small>{countSteps(sec.steps)} 工程{sectionExitCount(sec.steps, action) > 0 ? ` ・ 出口 ${sectionExitCount(sec.steps, action)}` : ""}</small>
                    <span className="pfs-caret" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                  </header>
                  {!isCollapsed && <div className="pfs-section-body">{body}</div>}
                </section>
              );
            })}
          </div>
        )}

        {tab === "exits" && (
          <div className="pfs-exits" data-testid="pfs-exits">
            <p className="pfs-note">この処理が終わるすべての出口と、そこへ行く条件です。抜けや、ありえない道が無いかを確かめます。クリックで、その行へ。</p>
            {[...exits].sort((a, b) => (a.status ?? 0) - (b.status ?? 0)).map((e) => (
              <button key={e.stepId} type="button" className="pfs-exit" onClick={() => jumpTo(e.stepId)} data-testid="pfs-exit">
                <span className={`pfs-status ${e.error ? "is-error" : "is-ok"}`}>{e.status ?? "—"}</span>
                <span className="pfs-exit-body">
                  <b>{e.label || "（説明なし）"}</b>
                  <span className="pfs-path">{e.path.length ? e.path.map((p, i) => <span key={i}>{p}</span>) : <span>ここまで来たら</span>}</span>
                </span>
              </button>
            ))}
            {exits.length === 0 && <p className="pfs-note">「返す」工程がありません。</p>}
          </div>
        )}

        {tab === "vars" && (
          <div className="pfs-vars" data-testid="pfs-vars">
            <p className="pfs-note">途中で作られ、あとで使われる変数です。選ぶと、流れの上で、作る場所と使う場所が光ります。</p>
            {vars.map((v) => (
              <button key={v.name} type="button" className="pfs-vrow" onClick={() => { setActiveVar(v.name); setTab("flow"); requestAnimationFrame(() => { const first = v.defIds[0]; if (first) jumpTo(first); }); }} data-testid="pfs-var-row">
                <span className="pfs-chip pfs-chip--var">{v.label}</span>
                <code>{v.name}</code>
                <span className="pfs-muted">{{ binding: "結果", loopItem: "繰り返しの 1 行", loopIndex: "繰り返しの番号", fieldErrors: "入力エラー", errorVar: "捕まえたエラー" }[v.how]}</span>
                <span className="pfs-vcount">作る {v.defIds.length} ・ 使う {v.useIds.length}</span>
              </button>
            ))}
            {vars.length === 0 && <p className="pfs-note">変数はありません。</p>}
          </div>
        )}
      </div>
    </StoryUiProvider>
  );
}

function sectionExitCount(steps: readonly Loose[], action: Pick<ActionDefinition, "responses">): number {
  let n = 0;
  walkSteps(steps, (s) => { if (s.kind === "return" && returnStatus(s, action) !== undefined) n++; });
  return n;
}

// ─── 工程の並び ─────────────────────────────────────────

function StepList({ steps, numPrefix, startIndex, env }: { steps: readonly Loose[]; numPrefix: string; startIndex: number; env: RowEnv }) {
  return (
    <>
      {steps.map((s, i) => (
        <StepNode key={s.id} step={s} num={`${numPrefix}${startIndex + i + 1}`} env={env} />
      ))}
    </>
  );
}

function StepNode({ step, num, env }: { step: Loose; num: string; env: RowEnv }) {
  const ui = useStoryUi().ctx;
  if (step.kind === "branch" && isGuardBranch(step)) return <GuardRow step={step} num={num} env={env} />;
  if (step.kind === "loopContinue" || step.kind === "loopBreak") {
    return (
      <div className="pfs-row pfs-row--quiet" data-step-id={step.id}>
        <span className="pfs-num" />
        <span className="pfs-kind pfs-kind--loop">{kindLabel(step)}</span>
        <div className="pfs-main"><div className="pfs-head">{step.kind === "loopContinue" ? "この行はここまで。次の行へ進む" : "繰り返しをここで終える"}</div></div>
        <span />
      </div>
    );
  }
  const groups = childGroups(step);
  const inside = groups.reduce((n, g) => n + countSteps(g.steps), 0);
  if (step.kind === "loop" || step.kind === "transactionScope") {
    const isTx = step.kind === "transactionScope";
    const body = groups.find((g) => g.role === "body");
    const rest = groups.filter((g) => g !== body);
    return (
      <div className={`pfs-box pfs-box--${isTx ? "tx" : "loop"}${env.hl.has(step.id) ? " is-hl" : ""}${env.flashId === step.id ? " is-flash" : ""}`} data-step-id={step.id}>
        <div className="pfs-box-head" onClick={() => env.onSelect(step.id)}>
          <span className="pfs-num">{num}</span>
          <span className="pfs-box-mark" aria-hidden="true">{isTx ? "▼" : "↻"}</span>
          <div className="pfs-main">
            <div className="pfs-head">
              {isTx ? "ここから 1 まとまり — " : ""}{stepHeadline(step)}
              {isTx && <span className="pfs-muted"> どれか 1 つでも失敗したら、全部取り消す</span>}
              <span className="pfs-inside">（中の工程 {inside} 件）</span>
            </div>
            <Chips chips={stepChips(step, ui)} />
          </div>
          <RowActions step={step} env={env} />
        </div>
        <div className="pfs-nest">
          {body && <StepList steps={body.steps} numPrefix={`${num}.`} startIndex={0} env={env} />}
        </div>
        {isTx && <div className="pfs-box-foot">▲ ここまで。すべて成功したら確定</div>}
        {rest.map((g) => <GroupBlock key={g.key} group={g} num={num} env={env} />)}
      </div>
    );
  }
  return (
    <>
      <StepRow step={step} num={num} env={env} inside={inside} />
      {groups.length > 0 && (
        <div className="pfs-nest">
          {groups.map((g) => <GroupBlock key={g.key} group={g} num={num} env={env} />)}
        </div>
      )}
    </>
  );
}

function GroupBlock({ group, num, env }: { group: ChildGroup; num: string; env: RowEnv }) {
  const segs = group.role === "arm" ? conditionSegments(group.condition) : [];
  const lead = group.role === "arm" ? "もし" : group.role === "else" ? "それ以外" : group.label;
  return (
    <div className={`pfs-arm pfs-arm--${group.role}`} data-testid={`pfs-arm-${group.role}`}>
      <div className="pfs-arm-head">
        <span className="pfs-arm-lab">{lead}</span>
        {group.role === "arm" && <><CondText segs={segs} /> なら</>}
        {group.label && (group.role === "arm" || group.role === "else") && <small className="pfs-muted"> ({group.label})</small>}
        {group.steps.length === 0 && <span className="pfs-muted"> → 次の工程へ</span>}
      </div>
      {group.steps.length > 0 && (
        <div className="pfs-arm-body">
          <StepList steps={group.steps} numPrefix={group.code ? `${num}-${group.code}-` : `${num}.`} startIndex={0} env={env} />
        </div>
      )}
    </div>
  );
}

// ─── 行 ────────────────────────────────────────────────

function RowActions({ step, env }: { step: Loose; env: RowEnv }) {
  const digest = stepDigest(step);
  const done = env.reviewed.isReviewed(step.id, digest);
  const stale = env.reviewed.isStale(step.id, digest);
  return (
    <span className="pfs-acts">
      {stale && <span className="pfs-stale" title="確認したあとに、この工程が変わりました">変更あり</span>}
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
      <button type="button" className="pfs-open" title="カードで開いて、編集する" aria-label="カードで開く" onClick={(e) => { e.stopPropagation(); env.onOpen(step.id); }}>
        <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
      </button>
    </span>
  );
}

function rowClass(step: Loose, env: RowEnv, extra = ""): string {
  return `pfs-row${extra ? ` ${extra}` : ""}${env.selected.has(step.id) ? " is-selected" : ""}${env.hl.has(step.id) ? " is-hl" : ""}${env.flashId === step.id ? " is-flash" : ""}`;
}

function StepRow({ step, num, env, inside }: { step: Loose; num: string; env: RowEnv; inside: number }) {
  const ui = useStoryUi().ctx;
  const status = step.kind === "return" ? returnStatus(step, ui.action) : undefined;
  const k = rowKindLabel(step, status);
  const code = env.zoom === "impl" ? stepCode(step) : undefined;
  const runIf = typeof step.runIf === "string" && step.runIf ? step.runIf : "";
  return (
    <div className={rowClass(step, env)} data-step-id={step.id} data-testid="pfs-row" onClick={() => env.onSelect(step.id)} onDoubleClick={() => env.onOpen(step.id)}>
      <span className="pfs-num">{num}</span>
      <span className={`pfs-kind pfs-kind--${k.tone}`}>{k.text}</span>
      <div className="pfs-main">
        <div className="pfs-head">
          {stepHeadline(step)}
          {inside > 0 && <span className="pfs-inside">（中の工程 {inside} 件）</span>}
        </div>
        <div className="pfs-sub">
          {runIf && <span className="pfs-runif" title={runIf}>↳ <CondTextInline expr={runIf} /> のときだけ</span>}
          <Chips chips={stepChips(step, ui)} />
        </div>
        {code && <pre className="pfs-code">{code}</pre>}
      </div>
      <RowActions step={step} env={env} />
    </div>
  );
}

function CondTextInline({ expr }: { expr: string }) {
  return <CondText segs={expressionSegments(expr)} />;
}

function GuardRow({ step, num, env }: { step: Loose; num: string; env: RowEnv }) {
  const ui = useStoryUi().ctx;
  const arm = childGroups(step).find((g) => g.role === "arm");
  const ret = arm?.steps[0];
  const status = ret ? returnStatus(ret, ui.action) : undefined;
  const resp = ret ? ui.action.responses?.find((r) => r.id === ret.responseId) : undefined;
  const code = env.zoom === "impl" && ret ? stepCode(ret) : undefined;
  return (
    <div className={rowClass(step, env, "pfs-row--guard")} data-step-id={step.id} data-testid="pfs-guard" onClick={() => env.onSelect(step.id)} onDoubleClick={() => env.onOpen(step.id)}>
      {ret && <span data-step-id={ret.id} className="pfs-anchor" />}
      <span className="pfs-num">{num}</span>
      <span className="pfs-kind pfs-kind--err">ガード</span>
      <div className="pfs-main">
        <div className="pfs-head">
          <CondText segs={conditionSegments(arm?.condition)} /> → <b className={`pfs-status-text ${(status ?? 0) >= 400 ? "is-error" : ""}`}>{status ?? ""}</b> {resp?.description ?? (ret ? stepHeadline(ret) : "")}
        </div>
        <div className="pfs-sub"><span className="pfs-muted">{stepHeadline(step)}</span></div>
        {code && <pre className="pfs-code">{code}</pre>}
      </div>
      <RowActions step={step} env={env} />
    </div>
  );
}
