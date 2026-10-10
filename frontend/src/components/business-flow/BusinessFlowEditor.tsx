/**
 * 業務フロー編集 (/business-flow/edit/:businessFlowId)。
 *
 * 左: レーンと工程の一覧 / 中央: 図 (原本から自動で配置) と要確認 / 右: 選んだ工程・レーンの設定。
 * 図の工程をクリックで選び、「次の工程を追加」で同じレーンに作ってつなぐ。
 * 編集は「編集開始」で編集セッションを作って行い (他の人・AI は閲覧のみ)、保存は明示的 (開いただけでは書き換えない)。
 * 仕様: docs/spec/business-flow.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BUSINESS_LANE_KIND_LABELS, layoutBusinessFlow, BUSINESS_STEP_KIND_LABELS, businessFlowToSvg, nextLaneId, nextStepId, removeStep, validateBusinessFlow,
  type BusinessFlow, type BusinessLane, type BusinessStep, type LaneKind, type StepKind,
} from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { listProcessFlows } from "../../store/processFlowStore";
import { loadConventions } from "../../store/conventionsStore";
import { loadBusinessFlow } from "../../store/businessFlowStore";
import { useEditableDocument } from "../../hooks/useEditableDocument";
import { EditSessionChrome } from "../editing/EditSessionChrome";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import { SortableList, SortableRow } from "../common/SortableList";
import { moveById } from "../../utils/reorder";
import "../../styles/businessFlow.css";

type Selection = { kind: "step" | "lane"; id: string } | null;
const STEP_ICON: Record<StepKind, string> = { start: "bi-play-circle", task: "bi-square", decision: "bi-diamond", end: "bi-stop-circle" };

export function BusinessFlowEditor() {
  const { businessFlowId } = useParams<{ businessFlowId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screens, setScreens] = useState<Array<{ id: string; name: string }>>([]);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [roles, setRoles] = useState<Array<{ key: string; name: string }>>([]);
  const [zoom, setZoom] = useState(1);
  const paperRef = useRef<HTMLDivElement>(null);

  // ── 文書 (編集セッション・元に戻す・他の保存の検知は useEditableDocument) ──
  const {
    doc: flow, editable, mode, sessionLoading, dirty, apply: applyDoc, undo, redo, canUndo, canRedo,
    attach, takeOver, syncSessionToUrl, sessionId, chrome,
  } = useEditableDocument<BusinessFlow>({
    resourceType: "business-flow",
    tabType: "business-flow",
    mtimeKind: "businessFlow",
    draftKind: "businessFlow",
    id: businessFlowId,
    load: loadBusinessFlow,
    broadcastName: "businessFlowChanged",
    broadcastIdField: "flowId",
    onNotFound: () => setMissing(true),
    autoEditKey: "business-flow",
  });
  // 変更の関数は、複製した文書を書き換えて返す (同じ結果なら何もしない)
  const apply = useCallback((fn: (f: BusinessFlow) => BusinessFlow) => applyDoc(fn), [applyDoc]);

  useEffect(() => {
    if (!businessFlowId) return;
    let alive = true;
    mcpBridge.startWithoutEditor();
    loadProject().then((p) => { if (alive) setScreens(p.screens.map((s) => ({ id: s.id as string, name: s.name as string }))); }).catch(() => undefined);
    listProcessFlows().then((l) => { if (alive) setFlows(l.map((m) => ({ id: m.id as string, name: (m.name as string) ?? (m.id as string) }))); }).catch(() => undefined);
    loadConventions().then((c) => {
      const role = (c as { role?: Record<string, { name?: string }> } | null)?.role ?? {};
      if (alive) setRoles(Object.entries(role).map(([key, v]) => ({ key, name: v?.name ?? key })));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [businessFlowId]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // 取り消し・読み直しで消えた工程・レーンの選択は外す
  useEffect(() => {
    if (!flow || !selection) return;
    const exists = selection.kind === "step" ? flow.steps.some((s) => s.id === selection.id) : flow.lanes.some((l) => l.id === selection.id);
    if (!exists) setSelection(null);
  }, [flow, selection]);

  // ── 検証・図 ──
  const refs = useMemo(() => ({
    screens: screens.length ? new Set(screens.map((s) => s.id)) : undefined,
    flows: flows.length ? new Set(flows.map((f) => f.id)) : undefined,
    roles: roles.length ? new Set(roles.map((r) => r.key)) : undefined,
  }), [screens, flows, roles]);
  const issues = useMemo(() => (flow ? validateBusinessFlow(flow, refs) : []), [flow, refs]);
  const problemIds = useMemo(() => new Set(issues.filter((i) => i.severity !== "info" && i.stepId).map((i) => i.stepId as string)), [issues]);
  const svg = useMemo(() => (flow ? businessFlowToSvg(flow, { interactive: true, selectedId: selection?.kind === "step" ? selection.id : undefined, problemIds, showRefs: true }) : ""), [flow, selection, problemIds]);

  // 図の拡大・縮小。「全体」は図の幅を表示領域に合わせる
  const fitZoom = useCallback(() => {
    if (!flow || !paperRef.current) return;
    const natural = layoutBusinessFlow(flow).width;
    setZoom(Math.max(0.4, Math.min(1, (paperRef.current.clientWidth - 2) / natural)));
  }, [flow]);

  // 開いたとき、図が表示領域より広ければ、自動で全体が見える大きさにする (1 度だけ。あとは利用者の操作を優先)
  const autoFitted = useRef<string | null>(null);
  useEffect(() => {
    if (!flow || sessionLoading || autoFitted.current === flow.id) return;
    // 描画後に幅を測る (図の領域がまだ無ければ、次の更新でやり直す)
    const t = setTimeout(() => {
      if (!paperRef.current) return;
      autoFitted.current = flow.id;
      fitZoom();
    }, 0);
    return () => clearTimeout(t);
  }, [flow, sessionLoading, fitZoom]);

  const selectedStep = flow && selection?.kind === "step" ? flow.steps.find((s) => s.id === selection.id) : undefined;
  const selectedLane = flow && selection?.kind === "lane" ? flow.lanes.find((l) => l.id === selection.id) : undefined;

  // ── 工程・レーンの操作 ──
  const addStep = useCallback((kind: StepKind, connectFrom?: string) => {
    if (!flow) return;
    const from = connectFrom ? flow.steps.find((s) => s.id === connectFrom) : undefined;
    const lane = from?.lane ?? selectedStep?.lane ?? selectedLane?.id ?? flow.lanes[0]?.id;
    if (!lane) { setNotice("先にレーンを追加してください"); return; }
    const id = nextStepId(flow);
    const name = { start: "開始", task: "新しい作業", decision: "新しい判断", end: "終了" }[kind];
    apply((f) => {
      f.steps.push({ id, lane, kind, name });
      if (from) {
        const src = f.steps.find((s) => s.id === from.id)!;
        if (src.kind !== "end") src.next = [...(src.next ?? []), { to: id }];
      }
      return f;
    });
    setSelection({ kind: "step", id });
  }, [flow, apply, selectedStep, selectedLane]);

  const patchStep = (id: string, patch: Partial<BusinessStep>) => apply((f) => {
    const s = f.steps.find((x) => x.id === id);
    if (s) for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") delete (s as unknown as Record<string, unknown>)[k]; else (s as unknown as Record<string, unknown>)[k] = v; }
    return f;
  });
  const patchLane = (id: string, patch: Partial<BusinessLane>) => apply((f) => {
    const l = f.lanes.find((x) => x.id === id);
    if (l) for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") delete (l as unknown as Record<string, unknown>)[k]; else (l as unknown as Record<string, unknown>)[k] = v; }
    return f;
  });
  const patchNext = (stepId: string, index: number, patch: { to?: string; label?: string }) => apply((f) => {
    const s = f.steps.find((x) => x.id === stepId);
    if (s?.next?.[index]) {
      const n = s.next[index];
      if (patch.to !== undefined) n.to = patch.to;
      if (patch.label !== undefined) { if (patch.label) n.label = patch.label; else delete n.label; }
    }
    return f;
  });
  const addNext = (stepId: string) => apply((f) => {
    const s = f.steps.find((x) => x.id === stepId);
    if (!s) return f;
    const taken = new Set((s.next ?? []).map((n) => n.to));
    const cand = f.steps.find((x) => x.id !== s.id && !taken.has(x.id));
    if (cand) s.next = [...(s.next ?? []), { to: cand.id }];
    return f;
  });
  const removeNext = (stepId: string, index: number) => apply((f) => {
    const s = f.steps.find((x) => x.id === stepId);
    if (s?.next) { s.next.splice(index, 1); if (!s.next.length) delete s.next; }
    return f;
  });
  const deleteStep = (id: string) => { apply((f) => removeStep(f, id)); setSelection(null); };
  const addLane = () => {
    if (!flow) return;
    const id = nextLaneId(flow);
    apply((f) => { f.lanes.push({ id, name: "新しいレーン", kind: "person" }); return f; });
    setSelection({ kind: "lane", id });
  };
  const moveLane = (id: string, d: -1 | 1) => apply((f) => {
    const i = f.lanes.findIndex((l) => l.id === id), j = i + d;
    if (i >= 0 && j >= 0 && j < f.lanes.length) [f.lanes[i], f.lanes[j]] = [f.lanes[j], f.lanes[i]];
    return f;
  });
  const reorderLanes = (activeId: string, overId: string) => apply((f) => { moveById(f.lanes, activeId, overId); return f; });
  const reorderSteps = (activeId: string, overId: string) => apply((f) => { moveById(f.steps, activeId, overId); return f; });
  const deleteLane = (id: string) => {
    if (!flow) return;
    const used = flow.steps.filter((s) => s.lane === id);
    if (used.length) { setNotice(`このレーンには工程が ${used.length} 件あります。工程を別のレーンへ移すか削除してから、レーンを削除してください`); return; }
    apply((f) => { f.lanes = f.lanes.filter((l) => l.id !== id); return f; });
    setSelection(null);
  };

  // ── 図の操作 ──
  const onDiagramClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest("[data-step]");
    setSelection(g ? { kind: "step", id: g.getAttribute("data-step") as string } : null);
  };
  const onDiagramKey = (e: React.KeyboardEvent) => {
    const g = (e.target as Element).closest("[data-step]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelection({ kind: "step", id: g.getAttribute("data-step") as string }); }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    // 元に戻す / やり直し / 保存は useEditableDocument が受け持つ
    if ((e.key === "Delete" || e.key === "Backspace") && selectedStep && editable) { e.preventDefault(); deleteStep(selectedStep.id); }
  };

  if (missing) {
    return (
      <div className="bfe-empty" data-testid="business-flow-missing">
        <p>業務フロー「{businessFlowId}」が見つかりません。</p>
        <button type="button" className="bfe-btn" onClick={() => navigate(wsPath("/business-flow/list"))}>一覧へ戻る</button>
      </div>
    );
  }
  if (!flow || sessionLoading) return <div className="bfe-empty"><p>読み込み中…</p></div>;

  const stepName = (id: string) => flow.steps.find((s) => s.id === id)?.name ?? id;
  const laneName = (id: string) => flow.lanes.find((l) => l.id === id)?.name ?? id;
  const counts = { error: issues.filter((i) => i.severity === "error").length, warning: issues.filter((i) => i.severity === "warning").length };

  return (
    <div className={`bfe${editable ? "" : " bfe-readonly"}`} data-testid="business-flow-editor" tabIndex={-1} onKeyDown={onKeyDown}>
      <EditSessionChrome {...chrome} />
      <div className="bfe-bar">
        <input className="bfe-title" value={flow.name} disabled={!editable} onChange={(e) => apply((f) => { f.name = e.target.value; return f; })} aria-label="業務フロー名" data-testid="bf-name" />
        <code className="bfe-id">{flow.id}</code>
        {dirty && <span className="bfe-dirty" data-testid="bf-dirty">未保存</span>}
        <span className="bfe-spacer" />
        <button type="button" className="bfe-btn" onClick={undo} disabled={!editable || !canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す"><i className="bi bi-arrow-counterclockwise" /></button>
        <button type="button" className="bfe-btn" onClick={redo} disabled={!editable || !canRedo} title="やり直す (Ctrl+Y)" aria-label="やり直す"><i className="bi bi-arrow-clockwise" /></button>
        <EditSessionDropdown
          resourceType="business-flow"
          resourceId={flow.id}
          currentMode={mode}
          currentSessionId={sessionId}
          onStartEditing={() => { void chrome.onStartEditing(); }}
          onViewerAttached={syncSessionToUrl}
          onAttachAsView={attach}
          onTakeOver={takeOver}
        />
      </div>
      {notice && <p className="bfe-notice" role="status" data-testid="bf-notice">{notice} <button type="button" className="bfe-link" onClick={() => setNotice(null)}>閉じる</button></p>}

      <div className="bfe-body">
        {/* 左: レーンと工程 */}
        <aside className="bfe-left" aria-label="レーンと工程">
          <section>
            <h4>レーン</h4>
            <SortableList className="bfe-list" testId="bf-lane-list" ids={flow.lanes.map((l) => l.id)} onReorder={reorderLanes} disabled={!editable}>
              {flow.lanes.map((l, i) => (
                <SortableRow key={l.id} id={l.id} disabled={!editable} label={l.name} className={selection?.kind === "lane" && selection.id === l.id ? "bfe-sel" : ""}>
                  <button type="button" className="bfe-row" onClick={() => setSelection({ kind: "lane", id: l.id })} data-testid={`bf-lane-${l.id}`}>
                    <i className={`bi ${l.kind === "system" ? "bi-cpu" : l.kind === "external" ? "bi-box-arrow-in-right" : "bi-person"}`} />
                    <span>{l.name}</span>
                  </button>
                  <span className="bfe-mini">
                    <button type="button" onClick={() => moveLane(l.id, -1)} disabled={!editable || i === 0} aria-label={`${l.name}を上へ`}><i className="bi bi-chevron-up" /></button>
                    <button type="button" onClick={() => moveLane(l.id, 1)} disabled={!editable || i === flow.lanes.length - 1} aria-label={`${l.name}を下へ`}><i className="bi bi-chevron-down" /></button>
                  </span>
                </SortableRow>
              ))}
            </SortableList>
            <button type="button" className="bfe-btn bfe-btn-dashed" onClick={addLane} disabled={!editable} data-testid="bf-add-lane"><i className="bi bi-plus-lg" /> レーンを追加</button>
          </section>
          <section>
            <h4>工程 <small>{flow.steps.length}</small></h4>
            <SortableList className="bfe-list bfe-steps" testId="bf-step-list" ids={flow.steps.map((s) => s.id)} onReorder={reorderSteps} disabled={!editable}>
              {flow.steps.map((s) => (
                <SortableRow key={s.id} id={s.id} disabled={!editable} label={s.name} className={selection?.kind === "step" && selection.id === s.id ? "bfe-sel" : ""}>
                  <button type="button" className="bfe-row" onClick={() => setSelection({ kind: "step", id: s.id })} data-testid={`bf-list-step-${s.id}`}>
                    <i className={`bi ${STEP_ICON[s.kind]}`} />
                    <span>{s.name}</span>
                    <small>{laneName(s.lane)}</small>
                    {problemIds.has(s.id) && <i className="bi bi-exclamation-triangle bfe-warn" title="要確認があります" />}
                  </button>
                </SortableRow>
              ))}
            </SortableList>
            <div className="bfe-add-row">
              {(["task", "decision", "start", "end"] as StepKind[]).map((k) => (
                <button key={k} type="button" className="bfe-btn bfe-btn-dashed" onClick={() => addStep(k)} disabled={!editable} data-testid={`bf-add-${k}`}><i className={`bi ${STEP_ICON[k]}`} /> {BUSINESS_STEP_KIND_LABELS[k]}</button>
              ))}
            </div>
            <p className="bfe-hint">選んだ工程の後ろにつないで追加します。</p>
          </section>
        </aside>

        {/* 中央: 図と要確認 */}
        <main className="bfe-center">
          <div className="bfe-zoom" role="group" aria-label="図の大きさ">
            <button type="button" className="bfe-btn" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="縮小" data-testid="bf-zoom-out"><i className="bi bi-zoom-out" /></button>
            <span className="bfe-zoom-val" data-testid="bf-zoom-val">{Math.round(zoom * 100)}%</span>
            <button type="button" className="bfe-btn" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label="拡大" data-testid="bf-zoom-in"><i className="bi bi-zoom-in" /></button>
            <button type="button" className="bfe-btn" onClick={fitZoom} data-testid="bf-zoom-fit">全体を表示</button>
            <button type="button" className="bfe-btn" onClick={() => setZoom(1)}>100%</button>
          </div>
          <div ref={paperRef} className="bfe-paper" style={{ ["--bf-zoom" as string]: zoom }} onClick={onDiagramClick} onKeyDown={onDiagramKey} data-testid="bf-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
          <section className="bfe-issues" aria-label="要確認">
            <h4>要確認 <small>{counts.error ? `エラー ${counts.error} ` : ""}{counts.warning ? `警告 ${counts.warning}` : ""}{!counts.error && !counts.warning ? "なし" : ""}</small></h4>
            {issues.filter((i) => i.severity !== "info").length > 0 && (
              <ul>
                {issues.filter((i) => i.severity !== "info").map((i, k) => (
                  <li key={k} className={`bfe-issue bfe-issue-${i.severity}`}>
                    <button type="button" className="bfe-link" onClick={() => i.stepId && setSelection({ kind: "step", id: i.stepId })} data-testid="bf-issue">{i.message}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        {/* 右: 設定 */}
        <aside className="bfe-right" aria-label="設定" data-testid="bf-inspector">
          <fieldset className="bfe-fieldset" disabled={!editable}>
          {selectedStep ? (
            <StepInspector
              step={selectedStep} flow={flow} screens={screens} flows={flows}
              stepName={stepName}
              onPatch={(p) => patchStep(selectedStep.id, p)}
              onPatchNext={(i, p) => patchNext(selectedStep.id, i, p)}
              onAddNext={() => addNext(selectedStep.id)}
              onRemoveNext={(i) => removeNext(selectedStep.id, i)}
              onAddFollowing={() => addStep("task", selectedStep.id)}
              onDelete={() => deleteStep(selectedStep.id)}
            />
          ) : selectedLane ? (
            <LaneInspector lane={selectedLane} roles={roles} onPatch={(p) => patchLane(selectedLane.id, p)} onDelete={() => deleteLane(selectedLane.id)} />
          ) : (
            <section className="bfe-form">
              <h4>業務フロー</h4>
              <label className="bfe-field"><span>説明</span><textarea rows={5} value={flow.description ?? ""} onChange={(e) => apply((f) => { if (e.target.value) f.description = e.target.value; else delete f.description; return f; })} data-testid="bf-description" /></label>
              <label className="bfe-field"><span>成熟度</span>
                <select value={flow.maturity ?? ""} onChange={(e) => apply((f) => { if (e.target.value) f.maturity = e.target.value as BusinessFlow["maturity"]; else delete f.maturity; return f; })}>
                  <option value="">(未設定)</option><option value="draft">作成中</option><option value="provisional">レビュー中</option><option value="committed">確定</option>
                </select>
              </label>
              <p className="bfe-hint">図の工程か、左の一覧の工程・レーンを選ぶと、ここで設定できます。</p>
            </section>
          )}
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function StepInspector(props: {
  step: BusinessStep; flow: BusinessFlow;
  screens: Array<{ id: string; name: string }>; flows: Array<{ id: string; name: string }>;
  stepName: (id: string) => string;
  onPatch: (p: Partial<BusinessStep>) => void;
  onPatchNext: (i: number, p: { to?: string; label?: string }) => void;
  onAddNext: () => void; onRemoveNext: (i: number) => void;
  onAddFollowing: () => void; onDelete: () => void;
}) {
  const { step, flow } = props;
  return (
    <section className="bfe-form" data-testid="bf-step-inspector">
      <h4>工程 <code>{step.id}</code></h4>
      <label className="bfe-field"><span>名前</span><input value={step.name} onChange={(e) => props.onPatch({ name: e.target.value })} data-testid="bf-step-name" /></label>
      <div className="bfe-row2">
        <label className="bfe-field"><span>種類</span>
          <select value={step.kind} onChange={(e) => props.onPatch({ kind: e.target.value as StepKind })} data-testid="bf-step-kind">
            {(Object.keys(BUSINESS_STEP_KIND_LABELS) as StepKind[]).map((k) => <option key={k} value={k}>{BUSINESS_STEP_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="bfe-field"><span>レーン</span>
          <select value={step.lane} onChange={(e) => props.onPatch({ lane: e.target.value })} data-testid="bf-step-lane">
            {flow.lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            {!flow.lanes.some((l) => l.id === step.lane) && <option value={step.lane}>{step.lane} (存在しない)</option>}
          </select>
        </label>
      </div>
      <label className="bfe-field"><span>説明</span><textarea rows={3} value={step.description ?? ""} onChange={(e) => props.onPatch({ description: e.target.value })} /></label>
      <label className="bfe-field"><span>実現する画面</span>
        <select value={step.screenRef ?? ""} onChange={(e) => props.onPatch({ screenRef: e.target.value })} data-testid="bf-step-screen">
          <option value="">(なし)</option>
          {props.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {step.screenRef && !props.screens.some((s) => s.id === step.screenRef) && <option value={step.screenRef}>{step.screenRef} (存在しない)</option>}
        </select>
      </label>
      <label className="bfe-field"><span>実現する処理フロー</span>
        <select value={step.processFlowRef ?? ""} onChange={(e) => props.onPatch({ processFlowRef: e.target.value })} data-testid="bf-step-flow">
          <option value="">(なし)</option>
          {props.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          {step.processFlowRef && !props.flows.some((f) => f.id === step.processFlowRef) && <option value={step.processFlowRef}>{step.processFlowRef} (存在しない)</option>}
        </select>
      </label>
      <div className="bfe-next">
        <h5>次の工程</h5>
        {(step.next ?? []).map((n, i) => (
          <div className="bfe-next-row" key={i}>
            <select value={n.to} onChange={(e) => props.onPatchNext(i, { to: e.target.value })} aria-label="次の工程" data-testid={`bf-next-to-${i}`}>
              {flow.steps.filter((s) => s.id !== step.id || s.id === n.to).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {!flow.steps.some((s) => s.id === n.to) && <option value={n.to}>{n.to} (存在しない)</option>}
            </select>
            <input value={n.label ?? ""} placeholder={step.kind === "decision" ? "条件 (例: あり)" : "条件 (任意)"} onChange={(e) => props.onPatchNext(i, { label: e.target.value })} aria-label="条件" data-testid={`bf-next-label-${i}`} />
            <button type="button" className="bfe-mini-btn" onClick={() => props.onRemoveNext(i)} aria-label="この線を削除"><i className="bi bi-x-lg" /></button>
          </div>
        ))}
        {!(step.next ?? []).length && <p className="bfe-hint">{step.kind === "end" ? "終了の工程には次がありません。" : "次の工程がありません。"}</p>}
        <div className="bfe-btn-row">
          <button type="button" className="bfe-btn bfe-btn-dashed" onClick={props.onAddNext} disabled={step.kind === "end"} data-testid="bf-add-next">既存の工程につなぐ</button>
          <button type="button" className="bfe-btn bfe-btn-dashed" onClick={props.onAddFollowing} disabled={step.kind === "end"} data-testid="bf-add-following"><i className="bi bi-plus-lg" /> 次の工程を追加</button>
        </div>
      </div>
      <button type="button" className="bfe-btn bfe-btn-danger" onClick={props.onDelete} data-testid="bf-step-delete"><i className="bi bi-trash" /> この工程を削除</button>
    </section>
  );
}

function LaneInspector(props: { lane: BusinessLane; roles: Array<{ key: string; name: string }>; onPatch: (p: Partial<BusinessLane>) => void; onDelete: () => void }) {
  const { lane } = props;
  return (
    <section className="bfe-form" data-testid="bf-lane-inspector">
      <h4>レーン <code>{lane.id}</code></h4>
      <label className="bfe-field"><span>名前</span><input value={lane.name} onChange={(e) => props.onPatch({ name: e.target.value })} data-testid="bf-lane-name" /></label>
      <label className="bfe-field"><span>種類</span>
        <select value={lane.kind ?? "person"} onChange={(e) => props.onPatch({ kind: e.target.value as LaneKind })}>
          {(Object.keys(BUSINESS_LANE_KIND_LABELS) as LaneKind[]).map((k) => <option key={k} value={k}>{BUSINESS_LANE_KIND_LABELS[k]}</option>)}
        </select>
      </label>
      <label className="bfe-field"><span>役割 (規約)</span>
        <select value={lane.roleRef ?? ""} onChange={(e) => props.onPatch({ roleRef: e.target.value })} data-testid="bf-lane-role">
          <option value="">(なし)</option>
          {props.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          {lane.roleRef && !props.roles.some((r) => r.key === lane.roleRef) && <option value={lane.roleRef}>{lane.roleRef} (存在しない)</option>}
        </select>
      </label>
      <label className="bfe-field"><span>説明</span><textarea rows={3} value={lane.description ?? ""} onChange={(e) => props.onPatch({ description: e.target.value })} /></label>
      <button type="button" className="bfe-btn bfe-btn-danger" onClick={props.onDelete} data-testid="bf-lane-delete"><i className="bi bi-trash" /> このレーンを削除</button>
    </section>
  );
}
