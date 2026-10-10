/**
 * 業務部品デザイナの左パネル。
 * - 部品: パレット (ドラッグで配置 / クリックで選択中の部品の後ろに追加)
 * - 画面項目: 未配置の項目をドラッグで配置
 * - テーブル: テーブル列をドラッグすると、型・桁・必須を引き継いだ入力項目を作って配置
 * - 構成: 部品の木 (クリックで選択)
 */
import { useMemo, useState, type DragEvent } from "react";
import { LAYOUT_NODE_LABELS, collectExpandedItemRefs, type LayoutComponentDef, type LayoutNode, type LayoutNodeType } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { Table } from "../../types/v3/table";
import { DND_MIME, setDragPayload, type DragPayload } from "./layoutDnd";
import { nodeTypeForItem } from "./layoutModel";

const GROUPS: Array<{ title: string; types: Array<{ type: LayoutNodeType; icon: string; hint: string }> }> = [
  {
    title: "画面の構成",
    types: [
      { type: "section", icon: "bi-card-heading", hint: "表題付きの枠" },
      { type: "form", icon: "bi-ui-checks-grid", hint: "入力項目を列で並べる" },
      { type: "search-panel", icon: "bi-search", hint: "検索条件の入力欄" },
      { type: "columns", icon: "bi-layout-three-columns", hint: "左右に段を分ける" },
      { type: "tabs", icon: "bi-segmented-nav", hint: "タブで切り替える" },
      { type: "button-bar", icon: "bi-menu-button-wide", hint: "ボタンを横に並べる" },
    ],
  },
  {
    title: "要素",
    types: [
      { type: "heading", icon: "bi-type-h1", hint: "画面・区画の見出し" },
      { type: "text", icon: "bi-text-paragraph", hint: "説明文・注意書き" },
      { type: "field", icon: "bi-input-cursor-text", hint: "新しい入力項目" },
      { type: "table", icon: "bi-table", hint: "新しい一覧" },
      { type: "button", icon: "bi-hand-index", hint: "操作ボタン" },
      { type: "link", icon: "bi-link-45deg", hint: "他画面へのリンク" },
      { type: "message-area", icon: "bi-chat-square-text", hint: "結果・エラーの表示" },
      { type: "image", icon: "bi-image", hint: "画像" },
      { type: "divider", icon: "bi-dash-lg", hint: "区切り線" },
    ],
  },
];

function startDrag(e: DragEvent, payload: DragPayload) {
  setDragPayload(payload);
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copyMove";
}

type Tab = "parts" | "items" | "tables" | "outline";

export interface LayoutPaletteProps {
  editable: boolean;
  nodes: LayoutNode[];
  items: ScreenItem[];
  tables: Table[];
  selectedId: string | null;
  onAdd: (type: LayoutNodeType) => void;
  onPlaceItem: (itemId: string) => void;
  onAddColumn: (tableId: string, columnId: string) => void;
  onSelect: (id: string) => void;
  /** プロジェクト独自部品 (パレットに並べる) */
  components?: LayoutComponentDef[];
  onAddComponent?: (componentId: string) => void;
  /** 独自部品の管理 (一覧・新規作成・編集・削除) を開く */
  onManageComponents?: () => void;
  /** 未配置の画面項目を、種類に応じた容器へ自動で配置する */
  onAutoPlace?: () => void;
}

export function LayoutPalette({ editable, nodes, items, tables, selectedId, onAdd, onPlaceItem, onAddColumn, onSelect, components = [], onAddComponent, onManageComponents, onAutoPlace }: LayoutPaletteProps) {
  const [tab, setTab] = useState<Tab>("parts");
  const [tableId, setTableId] = useState<string>("");
  // 独自部品の中 (args 経由) で使われている項目も「配置済み」に数える
  const placed = useMemo(() => collectExpandedItemRefs(nodes, components), [nodes, components]);
  const unplaced = items.filter((i) => !placed.has(i.id as string) && !i.nonVisual);
  const hidden = items.filter((i) => !placed.has(i.id as string) && i.nonVisual);
  const table = tables.find((t) => t.id === tableId) ?? tables[0];

  return (
    <aside className="sld-left" aria-label="部品パネル">
      <div className="sld-tabs" role="tablist">
        {([["parts", "部品"], ["items", `項目${unplaced.length ? ` (${unplaced.length})` : ""}`], ["tables", "テーブル"], ["outline", "構成"]] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)} data-testid={`layout-palette-tab-${k}`}>{l}</button>
        ))}
      </div>

      {tab === "parts" && (
        <div className="sld-left-body">
          {!editable && <p className="sld-hint">「編集開始」すると部品を置けます。</p>}
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h4 className="sld-group-title">{g.title}</h4>
              <div className="sld-parts">
                {g.types.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className="sld-part"
                    draggable={editable}
                    disabled={!editable}
                    onDragStart={(e) => startDrag(e, { kind: "new-node", nodeType: t.type })}
                    onDragEnd={() => setDragPayload(null)}
                    onClick={() => onAdd(t.type)}
                    title={`${t.hint}（ドラッグで配置 / クリックで選択中の部品の後ろに追加）`}
                    data-testid={`layout-part-${t.type}`}
                  >
                    <i className={`bi ${t.icon}`} />
                    <span>{LAYOUT_NODE_LABELS[t.type]}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {(components.length > 0 || onManageComponents) && (
            <section data-testid="layout-components-section">
              <h4 className="sld-group-title">独自部品</h4>
              {components.length === 0 && <p className="sld-hint">このプロジェクト専用の部品はまだありません。画面の部品を選んで「独自部品として登録」すると、ここに並びます。</p>}
              <div className="sld-parts">
                {components.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="sld-part sld-part-component"
                    draggable={editable}
                    disabled={!editable}
                    onDragStart={(e) => startDrag(e, { kind: "new-component", componentId: c.id, nodeType: "component" })}
                    onDragEnd={() => setDragPayload(null)}
                    onClick={() => onAddComponent?.(c.id)}
                    title={`${c.description ?? c.label}（ドラッグで配置 / クリックで選択中の部品の後ろに追加）`}
                    data-testid={`layout-component-${c.id}`}
                  >
                    <i className="bi bi-puzzle" />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
              {onManageComponents && (
                <button type="button" className="sld-btn sld-manage-components" onClick={onManageComponents} data-testid="layout-manage-components">
                  <i className="bi bi-gear" /> 独自部品の管理…
                </button>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "items" && (
        <div className="sld-left-body">
          <p className="sld-hint">未配置の画面項目 {unplaced.length} 件。ドラッグかクリックで画面に置きます。</p>
          {onAutoPlace && unplaced.length > 0 && (
            <button type="button" className="sld-btn" disabled={!editable} onClick={onAutoPlace} data-testid="layout-auto-place"
              title="入力は入力フォーム (「…Filter」は検索条件)、表示専用は項目を持つ区画、ボタンはボタン群、一覧は最後に置きます。置いたあとで動かせます">
              <i className="bi bi-magic" /> 未配置の項目を自動で配置 ({unplaced.length})
            </button>
          )}
          <ul className="sld-list">
            {unplaced.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="sld-list-item"
                  draggable={editable}
                  disabled={!editable}
                  onDragStart={(e) => startDrag(e, { kind: "place-item", itemId: i.id as string, nodeType: nodeTypeForItem(i) })}
                  onDragEnd={() => setDragPayload(null)}
                  onClick={() => onPlaceItem(i.id as string)}
                  data-testid={`layout-unplaced-${i.id}`}
                >
                  <span>{i.label || i.id}</span>
                  <code>{i.id}</code>
                </button>
              </li>
            ))}
          </ul>
          {hidden.length > 0 && (
            <>
              <h4 className="sld-group-title">画面に表示しない項目</h4>
              <p className="sld-hint">画面の内部状態・隠し値。クリックで画面に置くと、右パネルで「画面に表示しない」を外せます。</p>
              <ul className="sld-list sld-list-muted">
                {hidden.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="sld-list-item" disabled={!editable} onClick={() => onPlaceItem(i.id as string)} data-testid={`layout-hidden-${i.id}`}>
                      <span>{i.label || i.id}</span>
                      <code>{i.id}</code>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4 className="sld-group-title">配置済み</h4>
          <ul className="sld-list sld-list-muted">
            {items.filter((i) => placed.has(i.id as string)).map((i) => (
              <li key={i.id}><span>{i.label || i.id}</span><code>{i.id}</code></li>
            ))}
          </ul>
        </div>
      )}

      {tab === "tables" && (
        <div className="sld-left-body">
          {tables.length === 0 ? <p className="sld-hint">テーブル定義がありません。</p> : (
            <>
              <label className="sld-field-label" htmlFor="sld-table-select">テーブル</label>
              <select id="sld-table-select" className="sld-input" value={table?.id ?? ""} onChange={(e) => setTableId(e.target.value)}>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.name}（{t.physicalName}）</option>)}
              </select>
              <p className="sld-hint">列をドラッグすると、型・桁数・必須を引き継いだ入力項目を作って配置します。</p>
              <ul className="sld-list">
                {(table?.columns ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="sld-list-item"
                      draggable={editable}
                      disabled={!editable}
                      onDragStart={(e) => table && startDrag(e, { kind: "table-column", tableId: table.id, columnId: c.id, nodeType: "field" })}
                      onDragEnd={() => setDragPayload(null)}
                      onClick={() => table && onAddColumn(table.id, c.id)}
                      data-testid={`layout-column-${c.physicalName}`}
                    >
                      <span>{c.name}</span>
                      <code>{c.physicalName} {String(c.dataType)}{c.length ? `(${c.length})` : ""}</code>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "outline" && (
        <div className="sld-left-body">
          <Outline nodes={nodes} depth={0} selectedId={selectedId} onSelect={onSelect} items={items} components={components} />
          {nodes.length === 0 && <p className="sld-hint">部品がまだありません。</p>}
        </div>
      )}
    </aside>
  );
}

function Outline({ nodes, depth, selectedId, onSelect, items, components }: { nodes: LayoutNode[]; depth: number; selectedId: string | null; onSelect: (id: string) => void; items: ScreenItem[]; components: LayoutComponentDef[] }) {
  return (
    <ul className="sld-outline" style={{ paddingLeft: depth ? 12 : 0 }}>
      {nodes.map((n) => {
        const item = n.itemRef ? items.find((i) => i.id === n.itemRef) : undefined;
        const caption = n.type === "component"
          ? (components.find((c) => c.id === n.componentRef)?.label ?? n.componentRef ?? "")
          : (item?.label ?? n.props?.title ?? n.props?.text ?? n.props?.label ?? "");
        return (
          <li key={n.id}>
            <button type="button" className={`sld-outline-row${selectedId === n.id ? " active" : ""}`} onClick={() => onSelect(n.id)} data-testid={`layout-outline-${n.id}`}>
              <span className="sld-outline-type">{LAYOUT_NODE_LABELS[n.type]}</span>
              <span className="sld-outline-caption">{caption}</span>
            </button>
            {n.children && n.children.length > 0 && <Outline nodes={n.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} items={items} components={components} />}
          </li>
        );
      })}
    </ul>
  );
}
