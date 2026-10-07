/**
 * 業務部品デザイナの右パネル。選択中の部品の属性と、部品が参照する画面項目の定義を編集する。
 * 何も選択していないときは、画面全体の検証結果 (要確認事項) を表示する。
 */
import { useState, type ReactNode } from "react";
import { LAYOUT_NODE_LABELS, type LayoutIssue, type LayoutNode, type LayoutNodeProps } from "@harmony/shared";
import type { ScreenItem, ScreenItemPresentationColumn } from "../../types/v3/screen-item";
import { isValidNodeId } from "./layoutModel";

export interface LayoutInspectorProps {
  editable: boolean;
  node: LayoutNode | null;
  nodes: LayoutNode[];
  items: ScreenItem[];
  issues: LayoutIssue[];
  screens: Array<{ id: string; name: string }>;
  /** commit=false は入力中 (undo 履歴に積まない)、true で確定 */
  onNodeChange: (id: string, fn: (n: LayoutNode) => LayoutNode, commit: boolean) => void;
  onItemChange: (itemId: string, fn: (i: ScreenItem) => ScreenItem, commit: boolean) => void;
  onRenameNode: (oldId: string, newId: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddChild: (type: "column" | "tab") => void;
  onSelect: (id: string | null) => void;
  onCommit: () => void;
}

const PRIMITIVES: Array<[string, string]> = [
  ["string", "文字"], ["integer", "整数"], ["number", "数値"], ["date", "日付"], ["datetime", "日時"], ["boolean", "真偽 (チェック)"], ["json", "JSON"],
];

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="sld-row">
      <label className="sld-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/** 入力中は onLive、フォーカスを外すと onDone を呼ぶテキスト入力 */
function TextInput({ id, value, onLive, onDone, disabled, multiline, placeholder, mono }: {
  id: string; value: string; onLive: (v: string) => void; onDone: () => void; disabled: boolean; multiline?: boolean; placeholder?: string; mono?: boolean;
}) {
  const cls = `sld-input${mono ? " sld-mono" : ""}`;
  return multiline ? (
    <textarea id={id} className={cls} rows={4} value={value} disabled={disabled} placeholder={placeholder}
      onChange={(e) => onLive(e.target.value)} onBlur={onDone} />
  ) : (
    <input id={id} className={cls} value={value} disabled={disabled} placeholder={placeholder}
      onChange={(e) => onLive(e.target.value)} onBlur={onDone} />
  );
}

function NumberInput({ id, value, onChange, disabled, min, max }: { id: string; value: number | undefined; onChange: (v: number | undefined) => void; disabled: boolean; min?: number; max?: number }) {
  return (
    <input id={id} type="number" className="sld-input sld-num" value={value ?? ""} min={min} max={max} disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
  );
}

export function LayoutInspector(props: LayoutInspectorProps) {
  const { node } = props;
  return (
    <aside className="sld-right" aria-label="詳細">
      {node ? <NodePanel key={node.id} {...props} node={node} /> : <ScreenPanel {...props} />}
    </aside>
  );
}

function ScreenPanel({ issues, onSelect, items, nodes }: LayoutInspectorProps) {
  const sev = { error: issues.filter((i) => i.severity === "error"), warning: issues.filter((i) => i.severity === "warning"), info: issues.filter((i) => i.severity === "info") };
  let count = 0;
  const walk = (ns: LayoutNode[]) => ns.forEach((n) => { count++; if (n.children) walk(n.children); });
  walk(nodes);
  return (
    <div className="sld-right-body">
      <h3 className="sld-panel-title">画面の状態</h3>
      <div className="sld-stats">
        <div><b>{count}</b><span>部品</span></div>
        <div><b>{items.length}</b><span>画面項目</span></div>
        <div className={sev.error.length ? "is-error" : ""}><b>{sev.error.length}</b><span>エラー</span></div>
        <div className={sev.warning.length ? "is-warning" : ""}><b>{sev.warning.length}</b><span>警告</span></div>
      </div>
      <p className="sld-hint">部品をクリックすると、ここで詳細と画面項目の定義を編集できます。</p>
      {issues.length > 0 && <h4 className="sld-group-title">要確認</h4>}
      <ul className="sld-issues" data-testid="layout-issues">
        {[...sev.error, ...sev.warning, ...sev.info].map((i, k) => (
          <li key={k} className={`sld-issue sld-issue-${i.severity}`}>
            <button type="button" disabled={!i.nodeId} onClick={() => i.nodeId && onSelect(i.nodeId)}>
              <i className={`bi ${i.severity === "error" ? "bi-x-circle" : i.severity === "warning" ? "bi-exclamation-triangle" : "bi-info-circle"}`} />
              {i.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodePanel(props: LayoutInspectorProps & { node: LayoutNode }) {
  const { node, nodes, items, editable, onNodeChange, onItemChange, onRenameNode, onMove, onDuplicate, onDelete, onAddChild, onCommit, screens, onSelect } = props;
  const p = node.props ?? {};
  const item = node.itemRef ? items.find((i) => i.id === node.itemRef) : undefined;
  // 部品が切り替わると NodePanel は key で作り直されるため、下書き状態の同期は不要
  const [idDraft, setIdDraft] = useState(node.id);
  const [idError, setIdError] = useState<string | null>(null);

  const setProp = <K extends keyof LayoutNodeProps>(k: K, v: LayoutNodeProps[K] | undefined, commit = true) =>
    onNodeChange(node.id, (n) => {
      const next = { ...(n.props ?? {}) };
      if (v === undefined || v === "") delete next[k]; else next[k] = v;
      return { ...n, props: next };
    }, commit);

  const nodeIssues = props.issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="sld-right-body" data-testid="layout-inspector">
      <div className="sld-node-head">
        <span className="sld-node-type">{LAYOUT_NODE_LABELS[node.type]}</span>
        <div className="sld-node-actions">
          <button type="button" className="sld-icon-btn" title="前へ (Alt+↑)" disabled={!editable} onClick={() => onMove(-1)}><i className="bi bi-arrow-up" /></button>
          <button type="button" className="sld-icon-btn" title="後ろへ (Alt+↓)" disabled={!editable} onClick={() => onMove(1)}><i className="bi bi-arrow-down" /></button>
          <button type="button" className="sld-icon-btn" title="複製 (Ctrl+D)" disabled={!editable} onClick={onDuplicate}><i className="bi bi-copy" /></button>
          <button type="button" className="sld-icon-btn danger" title="削除 (Delete)" disabled={!editable} onClick={onDelete} data-testid="layout-delete-node"><i className="bi bi-trash" /></button>
          <button type="button" className="sld-icon-btn" title="選択を解除 (Esc)" onClick={() => onSelect(null)}><i className="bi bi-x-lg" /></button>
        </div>
      </div>

      {nodeIssues.map((i, k) => <div key={k} className={`sld-inline-issue sld-issue-${i.severity}`}>{i.message}</div>)}

      <Row label="部品 ID" htmlFor="sld-node-id">
        <input id="sld-node-id" className="sld-input sld-mono" value={idDraft} disabled={!editable}
          onChange={(e) => { setIdDraft(e.target.value); setIdError(isValidNodeId(e.target.value, nodes, node.id)); }}
          onBlur={() => { if (!idError && idDraft !== node.id) onRenameNode(node.id, idDraft); else { setIdDraft(node.id); setIdError(null); } }} />
        {idError && <div className="sld-error-text">{idError}</div>}
      </Row>

      {/* ── 種別ごとの属性 ── */}
      {node.type === "heading" && (
        <>
          <Row label="見出し" htmlFor="sld-text"><TextInput id="sld-text" value={p.text ?? ""} disabled={!editable} onLive={(v) => setProp("text", v, false)} onDone={onCommit} /></Row>
          <Row label="階層" htmlFor="sld-level">
            <select id="sld-level" className="sld-input" value={p.level ?? 2} disabled={!editable} onChange={(e) => setProp("level", Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 (画面見出し)</option><option value={2}>2 (区画見出し)</option><option value={3}>3 (小見出し)</option>
            </select>
          </Row>
        </>
      )}
      {node.type === "text" && (
        <>
          <Row label="文章" htmlFor="sld-text"><TextInput id="sld-text" multiline value={p.text ?? ""} disabled={!editable} onLive={(v) => setProp("text", v, false)} onDone={onCommit} /></Row>
          <Row label="調子" htmlFor="sld-tone">
            <select id="sld-tone" className="sld-input" value={p.tone ?? "normal"} disabled={!editable} onChange={(e) => setProp("tone", e.target.value as LayoutNodeProps["tone"])}>
              <option value="normal">通常</option><option value="muted">補足 (淡色)</option><option value="note">注記</option><option value="warning">注意</option>
            </select>
          </Row>
        </>
      )}
      {(node.type === "section" || node.type === "form" || node.type === "search-panel" || node.type === "tab") && (
        <Row label="表題" htmlFor="sld-title"><TextInput id="sld-title" value={p.title ?? ""} disabled={!editable} onLive={(v) => setProp("title", v, false)} onDone={onCommit} placeholder={node.type === "search-panel" ? "検索条件" : ""} /></Row>
      )}
      {node.type === "section" && (
        <Row label="外枠" htmlFor="sld-variant">
          <select id="sld-variant" className="sld-input" value={p.variant ?? "card"} disabled={!editable} onChange={(e) => setProp("variant", e.target.value as LayoutNodeProps["variant"])}>
            <option value="card">カード</option><option value="panel">パネル</option><option value="plain">枠なし</option>
          </select>
        </Row>
      )}
      {(node.type === "form" || node.type === "search-panel") && (
        <Row label="列数" htmlFor="sld-columns">
          <div className="sld-segmented" id="sld-columns">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" disabled={!editable} className={(p.columns ?? 1) === n ? "active" : ""} onClick={() => setProp("columns", n as 1 | 2 | 3 | 4)}>{n}</button>
            ))}
          </div>
        </Row>
      )}
      {node.type === "column" && (
        <Row label="幅 (12 分割)" htmlFor="sld-span"><NumberInput id="sld-span" value={p.span} min={1} max={12} disabled={!editable} onChange={(v) => setProp("span", v)} /></Row>
      )}
      {node.type === "columns" && (
        <div className="sld-row">
          <span className="sld-field-label">段 ({node.children?.length ?? 0})</span>
          <div className="sld-chips">{(node.children ?? []).map((c) => <button key={c.id} type="button" className="sld-chip" onClick={() => onSelect(c.id)}>{c.id} ({c.props?.span ?? "-"})</button>)}</div>
          <button type="button" className="sld-btn" disabled={!editable} onClick={() => onAddChild("column")}><i className="bi bi-plus" /> 段を追加</button>
        </div>
      )}
      {node.type === "tabs" && (
        <div className="sld-row">
          <span className="sld-field-label">タブ ({node.children?.length ?? 0})</span>
          <div className="sld-chips">{(node.children ?? []).map((c) => <button key={c.id} type="button" className="sld-chip" onClick={() => onSelect(c.id)}>{c.props?.title ?? c.id}</button>)}</div>
          <button type="button" className="sld-btn" disabled={!editable} onClick={() => onAddChild("tab")}><i className="bi bi-plus" /> タブを追加</button>
        </div>
      )}
      {node.type === "button-bar" && (
        <Row label="配置" htmlFor="sld-align">
          <select id="sld-align" className="sld-input" value={p.align ?? "left"} disabled={!editable} onChange={(e) => setProp("align", e.target.value as LayoutNodeProps["align"])}>
            <option value="left">左寄せ</option><option value="center">中央</option><option value="right">右寄せ</option><option value="between">両端</option>
          </select>
        </Row>
      )}
      {(node.type === "button" || node.type === "link") && (
        <>
          <Row label="表示文言" htmlFor="sld-label"><TextInput id="sld-label" value={p.label ?? ""} disabled={!editable} onLive={(v) => setProp("label", v, false)} onDone={onCommit} placeholder={item?.label as string | undefined} /></Row>
          {node.type === "button" && (
            <Row label="強調" htmlFor="sld-bvariant">
              <select id="sld-bvariant" className="sld-input" value={p.variant ?? "secondary"} disabled={!editable} onChange={(e) => setProp("variant", e.target.value as LayoutNodeProps["variant"])}>
                <option value="primary">主ボタン</option><option value="secondary">通常</option><option value="danger">危険 (削除等)</option><option value="link">リンク風</option>
              </select>
            </Row>
          )}
          <Row label="遷移先画面" htmlFor="sld-screen">
            <select id="sld-screen" className="sld-input" value={p.screenRef ?? ""} disabled={!editable} onChange={(e) => setProp("screenRef", e.target.value || undefined)}>
              <option value="">（なし）</option>
              {props.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Row>
        </>
      )}
      {node.type === "image" && (
        <>
          <Row label="画像の参照先" htmlFor="sld-src"><TextInput id="sld-src" value={p.src ?? ""} disabled={!editable} onLive={(v) => setProp("src", v, false)} onDone={onCommit} mono /></Row>
          <Row label="代替テキスト" htmlFor="sld-alt"><TextInput id="sld-alt" value={p.alt ?? ""} disabled={!editable} onLive={(v) => setProp("alt", v, false)} onDone={onCommit} /></Row>
        </>
      )}
      {node.type === "html" && (
        <>
          <p className="sld-hint">旧形式から業務部品に変換できなかった部分です。可能なら業務部品に置き換えてください。</p>
          <Row label="HTML" htmlFor="sld-html"><TextInput id="sld-html" multiline mono value={p.html ?? ""} disabled={!editable} onLive={(v) => setProp("html", v, false)} onDone={onCommit} /></Row>
        </>
      )}

      {(node.type === "field" || node.type === "table" || node.type === "button") && (
        <Row label="画面項目" htmlFor="sld-itemref">
          <select id="sld-itemref" className="sld-input" value={node.itemRef ?? ""} disabled={!editable}
            onChange={(e) => onNodeChange(node.id, (n) => { const next = { ...n }; if (e.target.value) next.itemRef = e.target.value; else delete next.itemRef; return next; }, true)}>
            <option value="">（未割当）</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.label || i.id}（{i.id}）</option>)}
          </select>
        </Row>
      )}

      {item && <ItemEditor key={item.id as string} item={item} editable={editable} onItemChange={onItemChange} onCommit={onCommit} isTable={node.type === "table"} />}

      <Row label="設計メモ" htmlFor="sld-note">
        <TextInput id="sld-note" multiline value={node.note ?? ""} disabled={!editable} placeholder="AI・開発者への補足 (任意)"
          onLive={(v) => onNodeChange(node.id, (n) => { const next = { ...n }; if (v) next.note = v; else delete next.note; return next; }, false)} onDone={onCommit} />
      </Row>
      {screens.length === 0 && null}
    </div>
  );
}

function ItemEditor({ item, editable, onItemChange, onCommit, isTable }: {
  item: ScreenItem; editable: boolean; isTable: boolean;
  onItemChange: LayoutInspectorProps["onItemChange"]; onCommit: () => void;
}) {
  const id = item.id as string;
  const set = <K extends keyof ScreenItem>(k: K, v: ScreenItem[K] | undefined, commit = true) =>
    onItemChange(id, (i) => { const next = { ...i }; if (v === undefined || (v as unknown) === "") delete next[k]; else next[k] = v; return next; }, commit);
  const primitive = typeof item.type === "string" ? item.type : "";
  const optionsText = (item.options ?? []).map((o) => (o.value === o.label ? o.value : `${o.value}:${o.label}`)).join("\n");
  const [optDraft, setOptDraft] = useState(optionsText);

  return (
    <div className="sld-item-editor" data-testid="layout-item-editor">
      <h4 className="sld-group-title">画面項目の定義 <code>{id}</code></h4>
      <Row label="項目名" htmlFor="sld-item-label"><TextInput id="sld-item-label" value={(item.label as string) ?? ""} disabled={!editable} onLive={(v) => set("label", v as ScreenItem["label"], false)} onDone={onCommit} /></Row>
      {!isTable && (
        <div className="sld-row-2">
          <Row label="型" htmlFor="sld-item-type">
            <select id="sld-item-type" className="sld-input" value={primitive} disabled={!editable || !primitive} onChange={(e) => set("type", e.target.value as ScreenItem["type"])}>
              {!primitive && <option value="">（構造型）</option>}
              {PRIMITIVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          <Row label="入出力" htmlFor="sld-item-dir">
            <select id="sld-item-dir" className="sld-input" value={item.direction ?? "in"} disabled={!editable} onChange={(e) => set("direction", e.target.value as ScreenItem["direction"])}>
              <option value="in">入力</option><option value="out">表示</option><option value="both">入力・表示</option>
            </select>
          </Row>
        </div>
      )}
      {!isTable && item.direction !== "out" && (
        <>
          <div className="sld-checks">
            <label><input type="checkbox" checked={!!item.required} disabled={!editable} onChange={(e) => set("required", e.target.checked || undefined)} /> 必須</label>
            <label><input type="checkbox" checked={!!item.readonly} disabled={!editable} onChange={(e) => set("readonly", e.target.checked || undefined)} /> 読み取り専用</label>
          </div>
          {(primitive === "string" || primitive === "") && (
            <div className="sld-row-2">
              <Row label="最小桁" htmlFor="sld-item-minl"><NumberInput id="sld-item-minl" value={item.minLength} min={0} disabled={!editable} onChange={(v) => set("minLength", v)} /></Row>
              <Row label="最大桁" htmlFor="sld-item-maxl"><NumberInput id="sld-item-maxl" value={item.maxLength} min={1} disabled={!editable} onChange={(v) => set("maxLength", v)} /></Row>
            </div>
          )}
          {(primitive === "integer" || primitive === "number") && (
            <div className="sld-row-2">
              <Row label="最小値" htmlFor="sld-item-min"><NumberInput id="sld-item-min" value={item.min as number | undefined} disabled={!editable} onChange={(v) => set("min", v as ScreenItem["min"])} /></Row>
              <Row label="最大値" htmlFor="sld-item-max"><NumberInput id="sld-item-max" value={item.max as number | undefined} disabled={!editable} onChange={(v) => set("max", v as ScreenItem["max"])} /></Row>
            </div>
          )}
          <Row label="入力書式 (正規表現 / @conv 参照)" htmlFor="sld-item-pattern"><TextInput id="sld-item-pattern" mono value={(item.pattern as string) ?? ""} disabled={!editable} placeholder="例: @conv.regex.postalCode" onLive={(v) => set("pattern", v as ScreenItem["pattern"], false)} onDone={onCommit} /></Row>
          <Row label="入力例 (プレースホルダ)" htmlFor="sld-item-ph"><TextInput id="sld-item-ph" value={(item.placeholder as string) ?? ""} disabled={!editable} onLive={(v) => set("placeholder", v as ScreenItem["placeholder"], false)} onDone={onCommit} /></Row>
          <Row label="選択肢 (1 行 1 件、値:表示名)" htmlFor="sld-item-options">
            <textarea id="sld-item-options" className="sld-input sld-mono" rows={3} value={optDraft} disabled={!editable}
              onChange={(e) => setOptDraft(e.target.value)}
              onBlur={() => {
                const opts = optDraft.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
                  const k = l.indexOf(":");
                  return k > 0 ? { value: l.slice(0, k).trim(), label: l.slice(k + 1).trim() } : { value: l, label: l };
                });
                set("options", opts.length ? (opts as ScreenItem["options"]) : undefined);
              }} />
          </Row>
        </>
      )}
      {isTable && <ColumnsEditor item={item} editable={editable} onItemChange={onItemChange} />}
      <Row label="補足説明 (入力欄の下に表示)" htmlFor="sld-item-help"><TextInput id="sld-item-help" value={(item.helperText as string) ?? ""} disabled={!editable} onLive={(v) => set("helperText", v as ScreenItem["helperText"], false)} onDone={onCommit} /></Row>
      <Row label="説明 (設計書用)" htmlFor="sld-item-desc"><TextInput id="sld-item-desc" multiline value={(item.description as string) ?? ""} disabled={!editable} onLive={(v) => set("description", v as ScreenItem["description"], false)} onDone={onCommit} /></Row>
    </div>
  );
}

function ColumnsEditor({ item, editable, onItemChange }: { item: ScreenItem; editable: boolean; onItemChange: LayoutInspectorProps["onItemChange"] }) {
  const cols = item.presentation?.columns ?? [];
  const id = item.id as string;
  const setCols = (next: ScreenItemPresentationColumn[]) =>
    onItemChange(id, (i) => ({ ...i, presentation: { ...(i.presentation ?? { kind: "table" }), kind: i.presentation?.kind ?? "table", columns: next } }), true);
  if (item.presentation?.viewDefinitionId && cols.length === 0) {
    return <p className="sld-hint">列はビュー定義「{item.presentation.viewDefinitionId}」で定義されています。</p>;
  }
  return (
    <div className="sld-row">
      <span className="sld-field-label">一覧の列 ({cols.length})</span>
      <table className="sld-cols-table">
        <thead><tr><th>見出し</th><th>値の参照</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {cols.map((c, k) => (
            <tr key={c.id}>
              <td><input className="sld-input" value={c.label as string} disabled={!editable} aria-label={`列 ${k + 1} の見出し`}
                onChange={(e) => setCols(cols.map((x, j) => (j === k ? { ...x, label: e.target.value as typeof x.label } : x)))} /></td>
              <td><input className="sld-input sld-mono" value={c.path} disabled={!editable} aria-label={`列 ${k + 1} の値の参照`}
                onChange={(e) => setCols(cols.map((x, j) => (j === k ? { ...x, path: e.target.value } : x)))} /></td>
              <td><button type="button" className="sld-icon-btn danger" disabled={!editable} title="列を削除" onClick={() => setCols(cols.filter((_, j) => j !== k))}><i className="bi bi-x" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="sld-btn" disabled={!editable} onClick={() => {
        let n = cols.length + 1;
        while (cols.some((c) => c.id === `col${n}`)) n++;
        setCols([...cols, { id: `col${n}` as ScreenItemPresentationColumn["id"], label: `列 ${n}` as ScreenItemPresentationColumn["label"], path: `col${n}`, type: "string" }]);
      }}><i className="bi bi-plus" /> 列を追加</button>
    </div>
  );
}
