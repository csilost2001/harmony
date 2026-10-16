/**
 * 業務部品デザイナの右パネル (複数の部品を選んでいるとき)。
 * まとめて、複製・削除・上へ / 下へ・入れ物で包む・共通の属性の変更ができる (UI 改善提案 第 3 弾 #43)。
 */
import { LAYOUT_NODE_LABELS, type LayoutNode, type LayoutNodeProps } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import { WRAP_TYPES, canWrap, selectedItemIds, sharedParentId } from "./layoutSelection";
import { AttrClipboardBar } from "./AttrClipboardBar";
import { applyAttrs } from "../../utils/itemAttrs";

export interface LayoutMultiPanelProps {
  editable: boolean;
  /** 整えた選択 (見た目の順) */
  ids: string[];
  nodes: LayoutNode[];
  items: ScreenItem[];
  onSelect: (ids: string[]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onWrap: (type: LayoutNode["type"]) => void;
  /** 選んだ部品が参照する項目すべてに、同じ変更を当てる */
  onPatchItems: (itemIds: string[], patch: (i: ScreenItem) => ScreenItem) => void;
  /** 選んだ部品そのものに、同じ属性の変更を当てる */
  onPatchNodes: (ids: string[], patch: (n: LayoutNode) => LayoutNode) => void;
}

type Tri = "keep" | "on" | "off";

export function LayoutMultiPanel({ editable, ids, nodes, items, onSelect, onDuplicate, onDelete, onMove, onWrap, onPatchItems, onPatchNodes }: LayoutMultiPanelProps) {
  const itemIds = selectedItemIds(nodes, ids);
  const targetItems = items.filter((i) => itemIds.includes(i.id as string));
  const flat = new Map<string, LayoutNode>();
  const collect = (list: LayoutNode[]) => list.forEach((n) => { flat.set(n.id, n); if (n.children) collect(n.children); });
  collect(nodes);
  const picked = ids.map((id) => flat.get(id)).filter((n): n is LayoutNode => !!n);
  const sameParent = sharedParentId(nodes, ids).ok;
  const forms = picked.filter((n) => n.type === "form" || n.type === "search-panel");
  const buttons = picked.filter((n) => n.type === "button");
  const inputItems = targetItems.filter((i) => i.direction !== "out");

  const setFlag = (key: "required" | "readonly", v: Tri) => {
    if (v === "keep") return;
    onPatchItems(inputItems.map((i) => i.id as string), (i) => {
      const next = { ...i } as Record<string, unknown>;
      if (v === "on") next[key] = true; else delete next[key];
      return next as unknown as ScreenItem;
    });
  };
  const setProp = (targets: LayoutNode[], key: keyof LayoutNodeProps, value: unknown) =>
    onPatchNodes(targets.map((n) => n.id), (n) => ({ ...n, props: { ...(n.props ?? {}), [key]: value } }));

  const triButtons = (label: string, key: "required" | "readonly") => (
    <div className="sld-row">
      <span className="sld-field-label">{label} ({inputItems.length} 項目)</span>
      <div className="sld-segmented" role="group" aria-label={`${label}をまとめて変える`}>
        <button type="button" disabled={!editable || inputItems.length === 0} onClick={() => setFlag(key, "on")} data-testid={`layout-multi-${key}-on`}>する</button>
        <button type="button" disabled={!editable || inputItems.length === 0} onClick={() => setFlag(key, "off")} data-testid={`layout-multi-${key}-off`}>しない</button>
      </div>
    </div>
  );

  return (
    <div className="sld-right-body" data-testid="layout-multi-panel">
      <div className="sld-node-head">
        <span className="sld-node-type">{ids.length} 件を選択中</span>
        <div className="sld-node-actions">
          <button type="button" className="sld-icon-btn" title="前へ (Alt+↑)" aria-label="前へ" disabled={!editable || !sameParent} onClick={() => onMove(-1)}><i className="bi bi-arrow-up" /></button>
          <button type="button" className="sld-icon-btn" title="後ろへ (Alt+↓)" aria-label="後ろへ" disabled={!editable || !sameParent} onClick={() => onMove(1)}><i className="bi bi-arrow-down" /></button>
          <button type="button" className="sld-icon-btn" title="複製 (Ctrl+D)" aria-label="複製" disabled={!editable} onClick={onDuplicate} data-testid="layout-multi-duplicate"><i className="bi bi-copy" /></button>
          <button type="button" className="sld-icon-btn danger" title="削除 (Delete)" aria-label="削除" disabled={!editable} onClick={onDelete} data-testid="layout-multi-delete"><i className="bi bi-trash" /></button>
          <button type="button" className="sld-icon-btn" title="選択を解除 (Esc)" aria-label="選択を解除" onClick={() => onSelect([])}><i className="bi bi-x-lg" /></button>
        </div>
      </div>
      <div className="sld-chips" aria-label="選んでいる部品">
        {picked.map((n) => (
          <button key={n.id} type="button" className="sld-chip" title="この部品だけを選ぶ" onClick={() => onSelect([n.id])}>{LAYOUT_NODE_LABELS[n.type]} <code>{n.id}</code></button>
        ))}
      </div>
      {!sameParent && <p className="sld-hint">違う入れ物にある部品が混ざっているため、上へ / 下へと「包む」は使えません。</p>}

      <h2 className="sld-group-title">入れ物で包む</h2>
      <div className="sld-chips">
        {WRAP_TYPES.map((w) => (
          <button key={w.type} type="button" className="sld-btn" disabled={!editable || !canWrap(nodes, ids, w.type)} onClick={() => onWrap(w.type)} data-testid={`layout-multi-wrap-${w.type}`}>
            <i className="bi bi-box" /> {w.label}で包む
          </button>
        ))}
      </div>

      <h2 className="sld-group-title">共通の属性を、まとめて変える</h2>
      {targetItems.length === 0 && forms.length === 0 && buttons.length === 0 && <p className="sld-hint">まとめて変えられる属性を持つ部品 (入力項目・フォーム・ボタン) がありません。</p>}
      {targetItems.length > 0 && (
        <>
          <div className="sld-row">
            <label className="sld-field-label" htmlFor="sld-multi-dir">入出力 ({targetItems.length} 項目)</label>
            <select id="sld-multi-dir" className="sld-input" value="" disabled={!editable}
              onChange={(e) => { const v = e.target.value as ScreenItem["direction"]; if (v) onPatchItems(itemIds, (i) => ({ ...i, direction: v }) as ScreenItem); }}>
              <option value="">（そのまま）</option><option value="in">入力</option><option value="out">表示</option><option value="both">入力・表示</option>
            </select>
          </div>
          {triButtons("必須", "required")}
          {triButtons("読み取り専用", "readonly")}
          <AttrClipboardBar editable={editable} targetCount={targetItems.length} onPaste={(snap, keys) => onPatchItems(itemIds, (i) => applyAttrs(i, snap, keys))} />
        </>
      )}
      {forms.length > 0 && (
        <div className="sld-row">
          <span className="sld-field-label">列数 ({forms.length} 件)</span>
          <div className="sld-segmented" role="group" aria-label="列数をまとめて変える">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" disabled={!editable} onClick={() => setProp(forms, "columns", n)} data-testid={`layout-multi-columns-${n}`}>{n}</button>
            ))}
          </div>
        </div>
      )}
      {buttons.length > 0 && (
        <div className="sld-row">
          <label className="sld-field-label" htmlFor="sld-multi-bvariant">ボタンの強調 ({buttons.length} 件)</label>
          <select id="sld-multi-bvariant" className="sld-input" value="" disabled={!editable}
            onChange={(e) => { if (e.target.value) setProp(buttons, "variant", e.target.value); }}>
            <option value="">（そのまま）</option><option value="primary">主ボタン</option><option value="secondary">通常</option><option value="danger">危険 (削除等)</option><option value="link">リンク風</option>
          </select>
        </div>
      )}
    </div>
  );
}
