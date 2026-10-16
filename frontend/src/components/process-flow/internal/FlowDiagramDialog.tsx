/**
 * 処理フローの「図で見る」(UI 改善提案 続編 第 7 弾 #133 #134)。いま開いている処理 (アクション) の工程を、読み取り専用で図にする。
 * - 流れ図: 順次・分岐・繰り返し・トランザクションを、設計書と同じ描画 (layoutFlow / diagramToSvg) で。編集中の内容がそのまま映る
 * - シーケンス図: 呼び出し元・処理・DB・外部システムのやりとりを、Mermaid / PlantUML の文で (コピーして Wiki・設計書へ)
 * SVG ファイルとしても保存できる。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDiagramText, diagramToSvg, layoutFlow, processFlowSequenceText, standaloneSvg,
  type DiagramFormat, type FlowStep,
} from "@harmony/shared";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { saveTextFile } from "../../analysis/fileIo";
import { writeClipboardText } from "../../../utils/tableExport";
import { showToast } from "../../../utils/toast";
import "../../../styles/flowDiagramDialog.css";

interface ActionLike { id: string; name?: string; trigger?: string; steps: FlowStep[] }
interface Props {
  flowName: string;
  action: ActionLike;
  tables: ReadonlyArray<{ id: string; name: string; physicalName: string }>;
  screens: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
}

type Tab = "flow" | "sequence";
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
      <div ref={trapRef} className="fdd-modal" role="dialog" aria-modal="true" aria-label="図で見る" data-testid="flow-diagram-dialog">
        <header className="fdd-head">
          <h2><i className="bi bi-diagram-3" /> 図で見る <small>{title}</small></h2>
          <button type="button" className="fdd-close" onClick={onClose} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </header>
        <div className="fdd-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "flow"} className={tab === "flow" ? "is-on" : ""} onClick={() => setTab("flow")} data-testid="fdd-tab-flow">流れ図</button>
          <button type="button" role="tab" aria-selected={tab === "sequence"} className={tab === "sequence" ? "is-on" : ""} onClick={() => setTab("sequence")} data-testid="fdd-tab-sequence">シーケンス図</button>
        </div>
        {tab === "flow" ? (
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
