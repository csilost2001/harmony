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
import type { ActionDefinition, Step } from "../../../types/v3";
import type { FlowContext } from "@harmony/shared";
import type { ValidationError } from "../../../utils/actionValidation";
import { InlineText } from "./InlineText";
import { StepList, type RowEnv } from "./StoryRows";
import { setHeading, TOP, type ListAddr } from "./storyEdit";
import {
  asLooseList,
  buildVarLabels,
  collectExits,
  countSteps,
  reviewTargets,
  sectionsOf,
  stepDigest,
  variableFlow,
  walkSteps,
  type StoryCtx,
} from "./storyModel";
import { noteAction } from "./actionTracker";
import { buildShapeEnv } from "./sqlShape";
import { StoryUiProvider, type AutoEdit, type StoryEditApi } from "./storyUi";
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
  /** 確認済みの記録の置き場所を分けるための名前 (ワークスペース・処理フロー・アクション) */
  reviewKey: string;
  ctx: FlowContext;
  selectedStepIds: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  /** カードで開く (編集) */
  onOpenStep: (stepId: string) => void;
  /** 編集中か (閲覧中は、読むだけ) */
  editable?: boolean;
  /** 編集中の下書きのアクションを直す (編集中だけ) */
  onMutate?: (fn: (action: ActionDefinition) => void) => void;
  /** 流れ全体で使われている ID (新しい工程の ID が重ならないように) */
  flowIds?: () => Set<string>;
  tables?: StoryEditApi["tables"];
  ambient?: StoryEditApi["ambient"];
  /** 登録された外部システムの名前 (接続先の候補) */
  externalSystems?: readonly string[];
  /** AI への頼み (あれば) */
  onAskAi?: (prompt: string) => void;
  /** 直前の操作を取り消す (消したあとの「元に戻す」に使う) */
  onUndo?: () => void;
  /** 検査の指摘 (行に印を出す) */
  problems?: readonly ValidationError[];
}

export function ProcessFlowStory({ action, reviewKey, ctx, selectedStepIds, onSelectStep, onOpenStep, editable = false, onMutate, flowIds, tables, ambient, externalSystems, onAskAi, onUndo, problems }: ProcessFlowStoryProps) {
  const [zoom, setZoom] = useState<Zoom>(readZoom);
  const [tab, setTab] = useState<Tab>("flow");
  /** 畳んだ区切り (区切りの最初の工程の ID。見出しを足しても、ずれない) */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [activeVar, setActiveVarState] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [autoEdit, setAutoEdit] = useState<AutoEdit | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 変数の「前 / 次」で、いま何番目の場所にいるか (-1 は、まだ移っていない) */
  const varCursor = useRef(-1);
  // 見ているアクションの版を記録する (消したあとの「元に戻す」の確かめ)。画面を離れたら、記録を外す
  useEffect(() => { noteAction(action); }, [action]);
  useEffect(() => () => { noteAction(null); }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); if (autoTimer.current) clearTimeout(autoTimer.current); }, []);

  const changeZoom = useCallback((z: Zoom) => {
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, z); } catch { /* storage 不可 */ }
  }, []);
  const setActiveVar = useCallback((name: string | null) => { varCursor.current = -1; setActiveVarState(name); }, []);

  const steps = useMemo(() => asLooseList(action.steps), [action.steps]);
  const labels = useMemo(() => buildVarLabels(action), [action]);
  const shapeEnv = useMemo(() => buildShapeEnv(tables), [tables]);
  const storyCtx = useMemo<StoryCtx>(() => ({ flow: ctx, action, labels, shapeEnv }), [ctx, action, labels, shapeEnv]);
  const sections = useMemo(() => sectionsOf(steps), [steps]);
  const exits = useMemo(() => collectExits(action, labels), [action, labels]);
  const vars = useMemo(() => variableFlow(action, labels), [action, labels]);
  const targets = useMemo(() => reviewTargets(steps), [steps]);
  const digests = useMemo(() => new Map(targets.map((s) => [s.id, stepDigest(s)])), [targets]);
  const reviewed = useReviewedSteps(reviewKey);
  const reviewedCount = reviewed.countReviewed(digests);
  const sectionExits = useMemo(() => sections.map((sec) => collectExits({ ...action, steps: sec.steps as unknown as ActionDefinition["steps"] }, labels).length), [sections, action, labels]);

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
    // 「概要」では入れ子が畳まれて、行が見えないので、詳細に切り替える (一時的に。選んだ細かさは、書き換えない)
    if (zoom === "overview") setZoom("detail");
    setFlashId(stepId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [zoom]);

  const stepVar = useCallback((dir: 1 | -1) => {
    if (hlOrdered.length === 0) return;
    const cur = varCursor.current;
    const next = cur < 0 ? (dir === 1 ? 0 : hlOrdered.length - 1) : (cur + dir + hlOrdered.length) % hlOrdered.length;
    varCursor.current = next;
    jumpTo(hlOrdered[next]);
  }, [hlOrdered, jumpTo]);

  const problemMap = useMemo(() => {
    const m = new Map<string, ValidationError[]>();
    for (const p of problems ?? []) m.set(p.stepId, [...(m.get(p.stepId) ?? []), p]);
    return m;
  }, [problems]);

  /** 工程を入れたあと: 選んで、そこへ移り、続けて直す欄を開く (ひな型の種類による) */
  const onInserted = useCallback((items: Step[], key: string, addr: ListAddr) => {
    const first = items[0] as unknown as { id: string; branches?: Array<{ id: string }> } | undefined;
    if (!first) return;
    // 選ぶのは、最上位に足したときだけ (入れ子の中の工程は、カード表示の選びが、最上位の工程を前提にしているため)
    if (addr.ownerId === null) onSelectStep(first.id);
    const guard = items.find((i) => i.kind === "branch") as unknown as { id: string; branches?: Array<{ id: string }> } | undefined;
    let next: AutoEdit | null = null;
    if (key === "guard" && guard?.branches?.[0]) next = { stepId: guard.id, what: "cond", armId: guard.branches[0].id };
    else if (key === "lookup" || key === "db" || key === "kind:dbAccess") next = { stepId: first.id, what: "table" };
    else if (key === "return") next = { stepId: first.id, what: "response" };
    else if (key === "decision") next = { stepId: first.id, what: "decision" };
    else next = { stepId: first.id, what: "desc" };
    setAutoEdit(next);
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => setAutoEdit(null), 800);
    setFlashId(first.id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector(`[data-step-id="${CSS.escape(first.id)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [onSelectStep]);

  // 直す操作の回数。「元に戻す」は、その消す操作のあとに、別の操作をしていないときだけ効かせる
  const countedMutate = useCallback((fn: (a: ActionDefinition) => void) => { onMutate?.(fn); }, [onMutate]);
  const edit = useMemo<StoryEditApi | null>(() => (editable && onMutate ? { mutate: countedMutate, undo: onUndo, flowIds: flowIds ?? (() => new Set<string>()), tables: tables ?? [], ambient, externalSystems, askAi: onAskAi } : null), [editable, onMutate, countedMutate, onUndo, flowIds, tables, ambient, externalSystems, onAskAi]);
  const env: RowEnv = { zoom, selected: selectedStepIds, hl, flashId, reviewed, digests, problems: problemMap, onSelect: onSelectStep, onOpen: onOpenStep, onInserted };
  const ui = useMemo(() => ({ ctx: storyCtx, showNames: zoom === "impl", activeVar, setActiveVar, edit, autoEdit }), [storyCtx, zoom, activeVar, setActiveVar, edit, autoEdit]);

  if (steps.length === 0) {
    return (
      <StoryUiProvider value={ui}>
        <div className="pfs-empty" data-testid="process-flow-story">
          {edit ? (
            <>
              <p>工程がありません。最初の工程を足します。</p>
              <StepList steps={[]} addr={TOP} numPrefix="" startIndex={0} env={env} />
            </>
          ) : "工程がありません。編集を始めると、ここから工程を足せます。"}
        </div>
      </StoryUiProvider>
    );
  }

  const hasHeadings = sections.some((sec) => sec.heading);
  const TABS: Array<{ key: Tab; label: string; title: string; testid: string }> = [
    { key: "flow", label: "流れ", title: "入れ子と条件を、上から読む", testid: "pfs-tab-flow" },
    { key: "exits", label: `出口 (${exits.length})`, title: "この処理が終わるすべての出口と、そこへ行く条件", testid: "pfs-tab-exits" },
    { key: "vars", label: `変数 (${vars.length})`, title: "途中で作られ、あとで使われる変数", testid: "pfs-tab-vars" },
  ];
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-testid="${next.testid}"]`)?.focus());
  };

  return (
    <StoryUiProvider value={ui}>
      <div className={`pfs-root pfs-z-${zoom}`} ref={rootRef} data-testid="process-flow-story">
        <div className="pfs-toolbar">
          <div className="pfs-tabs" role="tablist" aria-label="流れの見方">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`pfs-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="pfs-panel"
                tabIndex={tab === t.key ? 0 : -1}
                title={t.title}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
                data-testid={t.testid}
              >
                {t.label}
              </button>
            ))}
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
            <i role="progressbar" aria-label="確認済みの進み具合" aria-valuemin={0} aria-valuemax={targets.length} aria-valuenow={reviewedCount}><b style={{ width: `${targets.length ? (100 * reviewedCount) / targets.length : 0}%` }} /></i>
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

        <div id="pfs-panel" role="tabpanel" aria-labelledby={`pfs-tab-${tab}`}>
          {tab === "flow" && (
            <div className="pfs-flow">
              {sections.map((sec, si) => {
                const sid = sec.steps[0].id;
                const isCollapsed = collapsed.has(sid);
                const body = <StepList steps={sec.steps} addr={TOP} numPrefix="" startIndex={sec.startIndex} env={env} />;
                const toggle = () => setCollapsed((cur) => { const n = new Set(cur); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
                if (!hasHeadings) return <div key={sid}>{body}</div>;
                return (
                  <section key={sid} className={`pfs-section${isCollapsed ? " is-collapsed" : ""}`} data-testid="pfs-section">
                    <header>
                      <h3 className="pfs-section-h3">
                        <button
                          type="button"
                          className="pfs-section-toggle"
                          aria-expanded={!isCollapsed}
                          aria-label={`${sec.heading ?? "はじめに"} を${isCollapsed ? "開く" : "畳む"}`}
                          onClick={toggle}
                        >
                          <span className="pfs-section-no">{sec.heading ? sections.slice(0, si + 1).filter((x) => x.heading).length : "•"}</span>
                          <span className="pfs-caret" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                        </button>
                        {edit && sec.heading ? (
                          <InlineText className="pfs-section-title" value={sec.heading} editable maxLength={80} placeholder="例: 与信と承認" ariaLabel="見出しを書き換える" onCommit={(v) => edit.mutate((a) => { setHeading(a.steps, sid, v); })} />
                        ) : (
                          <button type="button" className="pfs-section-title pfs-section-title--btn" onClick={toggle}>{sec.heading ?? "はじめに"}</button>
                        )}
                        <small>{countSteps(sec.steps)} 工程{sectionExits[si] > 0 ? ` ・ 出口 ${sectionExits[si]}` : ""}</small>
                        {edit && sec.heading && (
                          <button type="button" className="pfs-mini" title="この見出しを外す (前の区切りに合わさります)" aria-label="見出しを外す" onClick={() => edit.mutate((a) => { setHeading(a.steps, sid, ""); })}>見出しを外す</button>
                        )}
                      </h3>
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
              {[...exits].sort((a, b) => (a.status ?? 0) - (b.status ?? 0)).map((e, i) => (
                <button key={`${e.stepId}:${i}`} type="button" className="pfs-exit" onClick={() => jumpTo(e.stepId)} data-testid="pfs-exit">
                  <span className={`pfs-status ${e.error ? "is-error" : "is-ok"}`}>{e.status ?? "—"}</span>
                  <span className="pfs-exit-body">
                    <b>{e.label || "（説明なし）"}</b>
                    <span className="pfs-path">{e.path.length ? e.path.map((p, j) => <span key={j}>{p}</span>) : <span>ここまで来たら</span>}</span>
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
                <button key={v.name} type="button" className="pfs-vrow" onClick={() => { setActiveVar(v.name); jumpTo(v.defIds[0]); }} data-testid="pfs-var-row">
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
      </div>
    </StoryUiProvider>
  );
}

