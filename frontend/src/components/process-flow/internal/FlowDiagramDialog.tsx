/**
 * 処理フローの「図で見る・確かめる」(UI 改善提案 続編 第 7 弾 #133 #134、第 8 弾 #149 #150 #151)。いま開いている処理 (アクション) の工程を、読み取り専用で見る。
 * - 判定表: 分岐の枝 (条件・行われる処理) を表にし、「上記以外」の抜け・同じ条件・空の枝を指摘する
 * - 机上演習: 開始から順に辿り、分岐・繰り返しでは進む先を選ぶ (実行はしない)。通った工程・選んだ枝・定義された変数を残す
 * - 式を試す: 設計に書かれた式を、サンプルの値で評価する (範囲の外の書き方は、試せないと返す)
 * - 流れ図: 順次・分岐・繰り返し・トランザクションを、設計書と同じ描画 (layoutFlow / diagramToSvg) で。編集中の内容がそのまま映る
 * - シーケンス図: 呼び出し元・処理・DB・外部システムのやりとりを、Mermaid / PlantUML の文で (コピーして Wiki・設計書へ)
 * SVG ファイルとしても保存できる。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildDecisionTables } from "../../../utils/decisionTable";
import { choose, next, promptOf, startWalk, whereAmI, type WalkState } from "../../../utils/walkthrough";
import { collectExpressions, evaluateExpression, formatValue, referencedRoots } from "../../../utils/expressionEval";
import { sampleText } from "../../../utils/sampleValues";
import {
  buildDiagramText, diagramToSvg, layoutFlow, processFlowSequenceText, standaloneSvg,
  type DiagramFormat, type FlowStep,
} from "@harmony/shared";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { saveTextFile } from "../../analysis/fileIo";
import { writeClipboardText } from "../../../utils/tableExport";
import { showToast } from "../../../utils/toast";
import "../../../styles/flowDiagramDialog.css";

interface ActionLike { id: string; name?: string; trigger?: string; steps: FlowStep[]; inputs?: Array<{ name?: string; label?: string; type?: unknown }> }
interface Props {
  flowName: string;
  action: ActionLike;
  tables: ReadonlyArray<{ id: string; name: string; physicalName: string }>;
  screens: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
}

type Tab = "flow" | "sequence" | "decision" | "walk" | "eval";
const FORMATS: DiagramFormat[] = ["mermaid", "plantuml"];

export function FlowDiagramDialog({ flowName, action, tables, screens, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [tab, setTab] = useState<Tab>("flow");
  const [format, setFormat] = useState<DiagramFormat>("mermaid");
  const [zoom, setZoom] = useState(1);
  // Esc で閉じる (フォーカスが、ダイアログの外・ボタンの外にあっても)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ctx = useMemo(() => {
    const tn = new Map(tables.map((t) => [t.id, t.name || t.physicalName || t.id]));
    const sn = new Map(screens.map((s) => [s.id, s.name || s.id]));
    return { tableName: (id: string) => tn.get(id), screenName: (id: string) => sn.get(id) };
  }, [tables, screens]);

  const title = `${flowName} / ${action.name ?? ""}`;
  const svg = useMemo(() => standaloneSvg(diagramToSvg(layoutFlow(action, ctx), title)), [action, ctx, title]);
  const sequence = useMemo(() => processFlowSequenceText(action, format, ctx), [action, format, ctx]);
  const flowText = useMemo(() => buildDiagramText({ flows: [{ meta: { id: "x", name: flowName }, actions: [action] }], tables: [], screens: [], businessFlows: [] } as never, { kind: "processFlow", id: "x" }, format) ?? "", [action, flowName, format]);
  const stem = (flowName || "flow").replace(/[^A-Za-z0-9_-]+/g, "") || "flow";

  const copy = async (text: string, what: string) => {
    const ok = await writeClipboardText(text);
    showToast(ok ? `${what}をコピーしました` : "コピーできませんでした (ブラウザがクリップボードを許可していません)", ok ? "info" : "error");
  };

  return (
    <div className="fdd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="fdd-modal" role="dialog" aria-modal="true" aria-label="図で見る・確かめる" data-testid="flow-diagram-dialog">
        <header className="fdd-head">
          <h2><i className="bi bi-diagram-3" /> 図で見る・確かめる <small>{title}</small></h2>
          <button type="button" className="fdd-close" onClick={onClose} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </header>
        <div className="fdd-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "flow"} className={tab === "flow" ? "is-on" : ""} onClick={() => setTab("flow")} data-testid="fdd-tab-flow">流れ図</button>
          <button type="button" role="tab" aria-selected={tab === "sequence"} className={tab === "sequence" ? "is-on" : ""} onClick={() => setTab("sequence")} data-testid="fdd-tab-sequence">シーケンス図</button>
          <button type="button" role="tab" aria-selected={tab === "decision"} className={tab === "decision" ? "is-on" : ""} onClick={() => setTab("decision")} data-testid="fdd-tab-decision">判定表</button>
          <button type="button" role="tab" aria-selected={tab === "walk"} className={tab === "walk" ? "is-on" : ""} onClick={() => setTab("walk")} data-testid="fdd-tab-walk">机上演習</button>
          <button type="button" role="tab" aria-selected={tab === "eval"} className={tab === "eval" ? "is-on" : ""} onClick={() => setTab("eval")} data-testid="fdd-tab-eval">式を試す</button>
        </div>
        {tab === "decision" ? <DecisionTab steps={action.steps} />
          : tab === "walk" ? <WalkTab steps={action.steps} />
            : tab === "eval" ? <EvalTab action={action} />
              : tab === "flow" ? (
          <>
            <div className="fdd-tools">
              <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(1)))} aria-label="縮小"><i className="bi bi-dash-lg" /></button>
              <span aria-live="polite">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} aria-label="拡大"><i className="bi bi-plus-lg" /></button>
              <button type="button" onClick={() => setZoom(1)}>等倍</button>
              <span className="fdd-sep" />
              <button type="button" onClick={() => saveTextFile(`${stem}-flow.svg`, svg, "image/svg+xml")} data-testid="fdd-save-svg"><i className="bi bi-filetype-svg" /> SVG で保存</button>
              <select value={format} onChange={(e) => setFormat(e.target.value as DiagramFormat)} aria-label="テキストの図の形式">{FORMATS.map((f) => <option key={f} value={f}>{f === "mermaid" ? "Mermaid" : "PlantUML"}</option>)}</select>
              <button type="button" onClick={() => void copy(flowText, `${format === "mermaid" ? "Mermaid" : "PlantUML"} の流れ図`)} data-testid="fdd-copy-flow"><i className="bi bi-clipboard" /> 文をコピー</button>
            </div>
            <div className="fdd-body"><div className="fdd-svg" style={{ zoom }} data-testid="fdd-svg" dangerouslySetInnerHTML={{ __html: svg }} /></div>
          </>
        ) : (
          <>
            <div className="fdd-tools">
              <select value={format} onChange={(e) => setFormat(e.target.value as DiagramFormat)} aria-label="形式" data-testid="fdd-format">{FORMATS.map((f) => <option key={f} value={f}>{f === "mermaid" ? "Mermaid" : "PlantUML"}</option>)}</select>
              <button type="button" onClick={() => void copy(sequence, "シーケンス図の文")} data-testid="fdd-copy-sequence"><i className="bi bi-clipboard" /> 文をコピー</button>
              <span className="fdd-muted">呼び出し元・処理・DB・外部システムのやりとりを、工程の順に並べた下書きです。貼り付け先 (Mermaid / PlantUML に対応した Wiki など) で描かれます。</span>
            </div>
            <div className="fdd-body"><pre className="fdd-pre" data-testid="fdd-sequence-text">{sequence}</pre></div>
          </>
        )}
      </div>
    </div>
  );
}


// ── 判定表 (#149) ──────────────────────────────────────────────────────────

function DecisionTab({ steps }: { steps: FlowStep[] }) {
  const tables = useMemo(() => buildDecisionTables(steps), [steps]);
  const issueCount = tables.reduce((n, t) => n + t.issues.length, 0);
  return (
    <div className="fdd-body" data-testid="fdd-decision">
      {tables.length === 0 ? <p className="fdd-muted">この処理には、分岐の工程がありません。</p> : (
        <>
          <p className="fdd-muted">分岐 {tables.length} 件 ・ 指摘 {issueCount} 件。条件式は、書かれた文字で比べています (意味が同じでも、書き方が違えば、別の条件として扱います)。</p>
          {tables.map((t) => (
            <section key={t.stepId} className="fdd-section">
              <h3>{t.title} <code>{t.stepId}</code></h3>
              <table className="fdd-table">
                <thead><tr><th>枝</th><th>条件</th><th>行われる処理</th></tr></thead>
                <tbody>
                  {t.arms.map((a) => (
                    <tr key={a.code} className={a.isElse ? "is-else" : ""}>
                      <td><b>{a.code}</b> {a.label}</td>
                      <td><code>{a.condition || "(空)"}</code></td>
                      <td>{a.stepCount === 0 ? <span className="fdd-warn">なし</span> : <>{a.stepCount} 工程 — {a.firstStep}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.issues.length > 0 && <ul className="fdd-issues" data-testid="fdd-decision-issues">{t.issues.map((i, k) => <li key={k}><i className="bi bi-exclamation-triangle" /> {i}</li>)}</ul>}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

// ── 机上演習 (#151) ────────────────────────────────────────────────────────

function WalkTab({ steps }: { steps: FlowStep[] }) {
  const [state, setState] = useState<WalkState>(() => startWalk(steps));
  const prompt = promptOf(state);
  const text = state.log.map((l) => (l.kind === "choice" ? `  → ${l.text}` : l.kind === "end" ? `■ ${l.text}` : `・${l.text}`)).join("\n");
  return (
    <div className="fdd-body" data-testid="fdd-walk">
      <div className="fdd-tools">
        <button type="button" onClick={() => setState(startWalk(steps))} data-testid="fdd-walk-restart"><i className="bi bi-arrow-counterclockwise" /> 最初から</button>
        <button type="button" onClick={async () => { const ok = await writeClipboardText(text); showToast(ok ? "辿った道すじをコピーしました" : "コピーできませんでした", ok ? "info" : "error"); }} disabled={state.log.length === 0} data-testid="fdd-walk-copy"><i className="bi bi-clipboard" /> 道すじをコピー</button>
        <span className="fdd-muted">実行はしません。分岐・繰り返しでは、進む先を選んでください。</span>
      </div>
      <div className="fdd-walk-grid">
        <section className="fdd-walk-now" aria-live="polite">
          <h3>いまの工程{whereAmI(state).length > 1 ? <small> ({whereAmI(state).slice(1).join(" › ")})</small> : null}</h3>
          {prompt.kind === "end" ? <p className="fdd-end" data-testid="fdd-walk-end"><i className="bi bi-flag-fill" /> {prompt.reason}</p> : (
            <>
              <p className="fdd-walk-text" data-testid="fdd-walk-text">{prompt.text}</p>
              {prompt.kind === "step" ? (
                <button type="button" className="fdd-primary" onClick={() => setState(next(state))} data-testid="fdd-walk-next">次へ <i className="bi bi-chevron-right" /></button>
              ) : (
                <div className="fdd-choices" role="group" aria-label="進む先を選ぶ">
                  {prompt.choices.map((c) => <button key={c.id} type="button" onClick={() => setState(choose(state, c.id))} data-testid={`fdd-walk-choice-${c.id}`}>{c.label}</button>)}
                </div>
              )}
            </>
          )}
          <p className="fdd-muted">ここまでに定義された変数: {state.defined.length === 0 ? "なし" : state.defined.map((d) => `@${d}`).join("、")}</p>
        </section>
        <section className="fdd-walk-log">
          <h3>通った道すじ ({state.log.filter((l) => l.kind === "step").length} 工程)</h3>
          <ol data-testid="fdd-walk-log">
            {state.log.map((l, i) => <li key={i} className={`is-${l.kind}`}>{l.text}</li>)}
          </ol>
        </section>
      </div>
    </div>
  );
}

// ── 式を試す (#150) ────────────────────────────────────────────────────────

function EvalTab({ action }: { action: ActionLike }) {
  const sites = useMemo(() => collectExpressions(action.steps as never), [action.steps]);
  const [picked, setPicked] = useState(sites.length > 0 ? 0 : -1);
  const [source, setSource] = useState(sites[0]?.text ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const roots = useMemo(() => referencedRoots(source), [source]);
  // 変数の既定値: inputs は、処理の入力から作ったサンプル。ほかは null
  const defaultFor = (root: string): string => {
    if (root === "inputs") return JSON.stringify(Object.fromEntries((action.inputs ?? []).filter((i) => i.name).map((i, k) => [i.name, typeof i.type === "string" && (i.type === "number" || i.type === "integer") ? Number(sampleText({ label: i.label, id: i.name, type: i.type }, "typical", k).replace(/,/g, "")) : sampleText({ label: i.label, id: i.name, type: i.type }, "typical", k)])));
    return "null";
  };
  const parsed = useMemo(() => {
    const vars: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const r of roots) {
      const raw = values[r] ?? defaultFor(r);
      try { vars[r] = JSON.parse(raw); } catch { errors.push(`@${r} の値が JSON として読めません`); }
    }
    return { vars, errors };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultFor は action.inputs だけに依る
  }, [roots, values, action.inputs]);
  const result = parsed.errors.length > 0 ? null : evaluateExpression(source, parsed.vars);
  return (
    <div className="fdd-body" data-testid="fdd-eval">
      <p className="fdd-muted">設計に書かれた式を、サンプルの値で評価します (実行ではなく、決まった範囲の式だけを読み解く試し)。</p>
      <label className="fdd-field">試す式
        <select value={picked} onChange={(e) => { const i = Number(e.target.value); setPicked(i); if (sites[i]) setSource(sites[i].text); }} aria-label="試す式を選ぶ" data-testid="fdd-eval-pick">
          <option value={-1}>(自分で書く)</option>
          {sites.map((s, i) => <option key={`${s.stepId}:${i}`} value={i}>{s.stepId} / {s.where}: {s.text.slice(0, 50)}</option>)}
        </select>
      </label>
      <textarea className="fdd-eval-src" rows={3} value={source} onChange={(e) => { setSource(e.target.value); setPicked(-1); }} aria-label="式" data-testid="fdd-eval-source" spellCheck={false} />
      {roots.length > 0 && (
        <div className="fdd-eval-vars">
          {roots.map((r) => (
            <label key={r} className="fdd-field">@{r} の値 (JSON)
              <textarea rows={2} value={values[r] ?? defaultFor(r)} onChange={(e) => setValues((v) => ({ ...v, [r]: e.target.value }))} aria-label={`@${r} の値`} data-testid={`fdd-eval-var-${r}`} spellCheck={false} />
            </label>
          ))}
        </div>
      )}
      <div className="fdd-eval-result" role="status" aria-live="polite" data-testid="fdd-eval-result">
        {parsed.errors.length > 0 ? <span className="fdd-warn">{parsed.errors.join(" / ")}</span>
          : result && result.ok ? <>結果: <code>{formatValue(result.value)}</code>{typeof result.value === "boolean" && <span className={`fdd-chip ${result.value ? "is-true" : "is-false"}`}>{result.value ? "成り立つ" : "成り立たない"}</span>}</>
            : result ? <span className="fdd-warn"><i className="bi bi-exclamation-triangle" /> {result.error}</span> : null}
      </div>
    </div>
  );
}
