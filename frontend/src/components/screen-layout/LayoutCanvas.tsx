/**
 * 業務部品デザイナのキャンバス。部品の木を「完成画面に近い見た目」で描画し、
 * 選択・ドラッグ移動・ドロップを受け付ける。
 *
 * キャンバスは設計対象アプリの見本なので、アプリ UI のテーマ (ライト / ダーク) に関係なく
 * 紙面 (明色) で描く。色は styles/screenLayout.css の --pv-* を使う。
 */
import { createContext, useContext, useMemo, useState, type DragEvent, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { CONTAINER_TYPES, LAYOUT_NODE_LABELS, type LayoutNode, type LayoutNodeType } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import { ROOT_ID, computeDropTarget, getDragPayload, setDragPayload, DND_MIME, type DropTarget, type DragPayload } from "./layoutDnd";

export interface CanvasContextValue {
  itemsById: Map<string, ScreenItem>;
  screenNameById: Map<string, string>;
  selectedId: string | null;
  editable: boolean;
  showNotes: boolean;
  issuesByNode: Map<string, "error" | "warning">;
  onSelect: (id: string | null) => void;
}

const Ctx = createContext<CanvasContextValue | null>(null);
const useCanvas = (): CanvasContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error("LayoutCanvas context missing");
  return v;
};

// ── 項目の見た目 ────────────────────────────────────────────────────────────

function typeLabel(item: ScreenItem): string {
  const t = item.type as unknown;
  if (typeof t === "string") {
    return ({ string: "文字", number: "数値", integer: "整数", boolean: "真偽", date: "日付", datetime: "日時", json: "JSON" } as Record<string, string>)[t] ?? t;
  }
  const k = (t as { kind?: string })?.kind;
  return k === "array" ? "一覧" : k === "domain" ? "ドメイン" : k ?? "?";
}

function sampleFor(type: unknown, i: number): string {
  const t = typeof type === "string" ? type : "string";
  if (t === "integer") return String((i + 1) * 3);
  if (t === "number") return ((i + 1) * 1280).toLocaleString("ja-JP");
  if (t === "date") return `2026/10/0${i + 1}`;
  if (t === "datetime") return `2026/10/0${i + 1} 10:0${i}`;
  if (t === "boolean") return i % 2 === 0 ? "✓" : "";
  return "―";
}

function FieldControl({ item }: { item: ScreenItem }) {
  const t = typeof item.type === "string" ? item.type : "string";
  const ph = (item.placeholder as string | undefined) ?? "";
  if (item.direction === "out") {
    return <div className="pv-display">{ph || `（${item.label}）`}</div>;
  }
  if (item.options?.length) {
    return <div className="pv-input pv-select"><span>{item.options[0]?.label ?? "選択"}</span><i className="bi bi-chevron-down" /></div>;
  }
  if (t === "boolean") {
    return <div className="pv-check"><span className="pv-checkbox" />{item.label}</div>;
  }
  if (t === "date" || t === "datetime") {
    return <div className="pv-input"><span className="pv-ph">{ph || (t === "date" ? "YYYY/MM/DD" : "YYYY/MM/DD hh:mm")}</span><i className={`bi ${t === "date" ? "bi-calendar3" : "bi-clock"}`} /></div>;
  }
  if (t === "string" && (item.maxLength ?? 0) >= 200) {
    return <div className="pv-input pv-textarea"><span className="pv-ph">{ph}</span></div>;
  }
  return <div className={`pv-input${t === "integer" || t === "number" ? " pv-num" : ""}`}><span className="pv-ph">{ph}</span></div>;
}

function ItemNotes({ item }: { item: ScreenItem }) {
  const bits = [typeLabel(item)];
  if (item.maxLength) bits.push(`${item.maxLength}桁`);
  if (item.min !== undefined || item.max !== undefined) bits.push(`${item.min ?? ""}〜${item.max ?? ""}`);
  if (item.pattern) bits.push("書式あり");
  return (
    <span className="pv-notes">
      <code>{item.id}</code>
      {bits.map((b) => <span key={b}>{b}</span>)}
    </span>
  );
}

function FieldView({ node }: { node: LayoutNode }) {
  const { itemsById, showNotes } = useCanvas();
  const item = node.itemRef ? itemsById.get(node.itemRef) : undefined;
  if (!item) {
    return <div className="pv-missing"><i className="bi bi-exclamation-triangle" /> 画面項目が未設定です{node.itemRef ? `（${node.itemRef} が見つかりません）` : ""}</div>;
  }
  const t = typeof item.type === "string" ? item.type : "";
  return (
    <div className="pv-field">
      {t !== "boolean" && (
        <div className="pv-label">
          {item.label}
          {item.required && <span className="pv-required">必須</span>}
          {showNotes && <ItemNotes item={item} />}
        </div>
      )}
      <FieldControl item={item} />
      {item.helperText && <div className="pv-help">{item.helperText as string}</div>}
    </div>
  );
}

function TableView({ node }: { node: LayoutNode }) {
  const { itemsById, showNotes } = useCanvas();
  const item = node.itemRef ? itemsById.get(node.itemRef) : undefined;
  const cols = item?.presentation?.columns ?? [];
  const viewDef = item?.presentation?.viewDefinitionId;
  const title = node.props?.title ?? item?.label;
  return (
    <div className="pv-table-wrap">
      {title && (
        <div className="pv-table-title">
          {title}
          {showNotes && item && <ItemNotes item={item} />}
        </div>
      )}
      {!item ? (
        <div className="pv-missing"><i className="bi bi-exclamation-triangle" /> 一覧の画面項目が未設定です</div>
      ) : cols.length === 0 ? (
        <div className="pv-table-empty">
          <i className="bi bi-table" /> {viewDef ? `列はビュー定義「${viewDef}」で定義` : "列が未定義です（右の詳細で列を追加）"}
        </div>
      ) : (
        <table className="pv-table">
          <thead><tr>{cols.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
          <tbody>
            {[0, 1, 2].map((r) => (
              <tr key={r}>{cols.map((c) => <td key={c.id} className={c.type === "integer" || c.type === "number" ? "pv-num" : ""}>{sampleFor(c.type, r)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 部品 1 つ ──────────────────────────────────────────────────────────────

function NodeContent({ node }: { node: LayoutNode }) {
  const { itemsById, screenNameById } = useCanvas();
  const p = node.props ?? {};
  switch (node.type) {
    case "heading": {
      const Tag = (`h${p.level ?? 2}`) as "h1" | "h2" | "h3";
      return <Tag className={`pv-h pv-h${p.level ?? 2}`}>{p.text || "見出し"}</Tag>;
    }
    case "text":
      return <p className={`pv-text pv-tone-${p.tone ?? "normal"}`}>{p.text || "文章"}</p>;
    case "field":
      return <FieldView node={node} />;
    case "table":
      return <TableView node={node} />;
    case "button": {
      const item = node.itemRef ? itemsById.get(node.itemRef) : undefined;
      const label = p.label || item?.label || "ボタン";
      return (
        <span className={`pv-btn pv-btn-${p.variant ?? "secondary"}`}>
          {label}
          {p.screenRef && <span className="pv-goto">→ {screenNameById.get(p.screenRef) ?? p.screenRef}</span>}
        </span>
      );
    }
    case "link":
      return <span className="pv-link">{p.label || "リンク"}{p.screenRef && <span className="pv-goto">→ {screenNameById.get(p.screenRef) ?? p.screenRef}</span>}</span>;
    case "message-area":
      return <div className="pv-message"><i className="bi bi-info-circle" /> メッセージ表示領域（処理結果・エラーをここに表示）</div>;
    case "image":
      return <div className="pv-image"><i className="bi bi-image" /> {p.alt || "画像"}</div>;
    case "divider":
      return <hr className="pv-divider" />;
    case "html":
      return <div className="pv-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.html ?? "") }} />;
    default:
      return null;
  }
}

function containerClass(node: LayoutNode): string {
  switch (node.type) {
    case "form":
    case "search-panel":
      return `pv-grid pv-cols-${node.props?.columns ?? 1}`;
    case "columns":
      return "pv-columns";
    case "button-bar":
      return `pv-bar pv-align-${node.props?.align ?? "left"}`;
    default:
      return "pv-stack";
  }
}

function NodeView({ node, parentType }: { node: LayoutNode; parentType: LayoutNodeType | null }) {
  const { selectedId, editable, onSelect, issuesByNode } = useCanvas();
  const [activeTab, setActiveTab] = useState(0);
  const selected = selectedId === node.id;
  const issue = issuesByNode.get(node.id);
  const isContainer = CONTAINER_TYPES.has(node.type);
  const p = node.props ?? {};

  const onDragStart = (e: DragEvent) => {
    if (!editable) { e.preventDefault(); return; }
    e.stopPropagation();
    const payload: DragPayload = { kind: "move-node", nodeId: node.id, nodeType: node.type };
    setDragPayload(payload);
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const style = node.type === "column" ? { flex: `${p.span ?? 6} 1 0` } : undefined;
  const span = parentType === "form" || parentType === "search-panel"
    ? (node.type === "field" || node.type === "html" ? undefined : { gridColumn: "1 / -1" }) : undefined;

  let body: ReactNode;
  if (!isContainer) {
    body = <NodeContent node={node} />;
  } else if (node.type === "tabs") {
    const tabs = node.children ?? [];
    const idx = Math.min(activeTab, Math.max(tabs.length - 1, 0));
    body = (
      <div className="pv-tabs">
        <div className="pv-tab-strip">
          {tabs.map((t, i) => (
            <button key={t.id} type="button" className={`pv-tab${i === idx ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); setActiveTab(i); onSelect(t.id); }}>
              {t.props?.title || `タブ ${i + 1}`}
            </button>
          ))}
        </div>
        {tabs[idx] && (
          <div data-drop-parent={node.id} data-drop-parent-type="tabs" className="pv-stack">
            <NodeView node={tabs[idx]} parentType="tabs" />
          </div>
        )}
      </div>
    );
  } else {
    const kids = node.children ?? [];
    const list = (
      <div data-drop-parent={node.id} data-drop-parent-type={node.type} className={containerClass(node)}>
        {kids.map((c) => <NodeView key={c.id} node={c} parentType={node.type} />)}
        {kids.length === 0 && <div className="pv-empty-slot">{editable ? "ここに部品をドラッグ" : "（空）"}</div>}
      </div>
    );
    body = (
      <div className={`pv-container pv-${node.type}${node.type === "section" ? ` pv-variant-${p.variant ?? "card"}` : ""}`}>
        {(node.type === "section" || node.type === "form" || node.type === "search-panel") && (p.title || node.type === "search-panel") && (
          <div className="pv-container-title">{p.title || "検索条件"}</div>
        )}
        {list}
      </div>
    );
  }

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className={`sld-node${selected ? " is-selected" : ""}${issue ? ` has-${issue}` : ""}`}
      style={{ ...style, ...span }}
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={() => setDragPayload(null)}
      onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
      data-testid={`layout-node-${node.id}`}
    >
      <span className="sld-node-tag">{LAYOUT_NODE_LABELS[node.type]}<code>{node.id}</code></span>
      {body}
    </div>
  );
}

// ── キャンバス本体 ─────────────────────────────────────────────────────────

export interface LayoutCanvasProps extends Omit<CanvasContextValue, "itemsById"> {
  nodes: LayoutNode[];
  items: ScreenItem[];
  width: number;
  density: "standard" | "compact";
  onDrop: (payload: DragPayload, target: { parentId: string | null; index: number }) => void;
}

export function LayoutCanvas({ nodes, items, width, density, onDrop, ...ctx }: LayoutCanvasProps) {
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id as string, i])), [items]);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const value = useMemo(() => ({ ...ctx, itemsById }), [ctx, itemsById]);

  const handleDragOver = (e: DragEvent) => {
    const payload = getDragPayload();
    if (!payload || !ctx.editable) return;
    const t = computeDropTarget(e.target as Element, e.clientX, e.clientY, payload, nodes);
    if (t) {
      e.preventDefault();
      e.dataTransfer.dropEffect = payload.kind === "move-node" ? "move" : "copy";
    }
    setTarget(t);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const payload = getDragPayload();
    const t = payload ? computeDropTarget(e.target as Element, e.clientX, e.clientY, payload, nodes) : null;
    setTarget(null);
    setDragPayload(null);
    if (payload && t) onDrop(payload, { parentId: t.parentId, index: t.index });
  };

  return (
    <Ctx.Provider value={value}>
      <div
        className="sld-canvas-scroll"
        data-theme-audit-skip
        onClick={() => ctx.onSelect(null)}
        onDragOver={handleDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setTarget(null); }}
        onDrop={handleDrop}
        data-testid="layout-canvas"
      >
        <div className={`sld-paper pv-density-${density}${ctx.showNotes ? " pv-show-notes" : ""}`} style={{ width }}>
          <div data-drop-parent={ROOT_ID} className="pv-stack pv-root">
            {nodes.map((n) => <NodeView key={n.id} node={n} parentType={null} />)}
            {nodes.length === 0 && (
              <div className="pv-empty-root">
                <i className="bi bi-columns-gap" />
                <p>左の「部品」から、画面に置きたい部品をここへドラッグしてください。</p>
              </div>
            )}
          </div>
        </div>
        {target && <div className="sld-drop-line" style={{ left: target.line.left, top: target.line.top, width: target.line.width, height: target.line.height }} />}
      </div>
    </Ctx.Provider>
  );
}
