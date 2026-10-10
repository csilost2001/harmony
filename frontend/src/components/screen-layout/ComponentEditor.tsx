/**
 * プロジェクト独自部品の編集画面。画面デザイナと同じ部品パレット・キャンバス・詳細パネルで、
 * 部品の木 (テンプレート) を組み、「差し込み口」(画面ごとに変える箇所) を決める。
 *
 * 差し込み口のうち画面項目 (kind=item) は、キャンバスでは「{{id}}」という仮の項目として扱い、
 * パレットの「項目」からドラッグして入力欄・一覧・ボタンに割り当てる。
 * 仕様: docs/spec/layout-components.md
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  renameComponentParam, updateNode, validateComponentDefs, validateLayoutWithComponents, walkLayout,
  type LayoutComponentDef, type LayoutComponentParam, type LayoutComponentParamKind, type LayoutNode,
} from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import { LayoutCanvas } from "./LayoutCanvas";
import { LayoutPalette } from "./LayoutPalette";
import { LayoutInspector } from "./LayoutInspector";
import { useLayoutOps } from "./useLayoutOps";
import { type LayoutDoc } from "./layoutModel";

export interface ComponentEditorProps {
  initial: LayoutComponentDef;
  /** 新規作成中か (ID と差し込み口の ID は保存後は変えられない) */
  isNew: boolean;
  /** 全部品 (入れ子で他の独自部品を置くため)。編集中の部品は自分自身を含めない */
  others: LayoutComponentDef[];
  screens: Array<{ id: string; name: string }>;
  onSave: (def: LayoutComponentDef) => Promise<void>;
  onClose: () => void;
}

const virtualId = (paramId: string) => `{{${paramId}}}`;
const KIND_LABEL: Record<LayoutComponentParamKind, string> = { text: "文言", item: "画面項目", screen: "遷移先画面" };

/** 差し込み口 (kind=item) を、キャンバス・パレットが扱う仮の画面項目にする */
function toDoc(def: LayoutComponentDef): LayoutDoc {
  const items = def.params.filter((q) => q.kind === "item").map((q) => ({
    id: virtualId(q.id), label: q.label, type: "string", direction: "in",
  }) as unknown as ScreenItem);
  return { items, layout: { version: 1, nodes: def.nodes } };
}

/**
 * 操作後の doc を定義に戻す。操作の中で新しく作られた項目 (パレットの「項目」「一覧表」) は
 * 差し込み口 (kind=item) として追加し、部品の itemRef を {{差し込み口}} に書き換える。
 * 部品を消しても差し込み口は残す (画面側の args が参照している可能性があるため)。
 */
function fromDoc(next: LayoutDoc, prev: LayoutComponentDef): LayoutComponentDef {
  let params = [...prev.params];
  const rename = new Map<string, string>();
  for (const it of next.items) {
    const id = it.id as string;
    if (id.startsWith("{{")) continue;
    let pid = id; let k = 2;
    while (params.some((q) => q.id === pid)) pid = `${id}${k++}`;
    params = [...params, { id: pid, label: (it.label as string) || pid, kind: "item" }];
    rename.set(id, virtualId(pid));
  }
  const swap = (n: LayoutNode): LayoutNode => {
    const out: LayoutNode = { ...n };
    if (n.itemRef && rename.has(n.itemRef)) out.itemRef = rename.get(n.itemRef);
    if (n.children) out.children = n.children.map(swap);
    return out;
  };
  return { ...prev, params, nodes: (next.layout?.nodes ?? []).map(swap) };
}

interface History { past: LayoutComponentDef[]; present: LayoutComponentDef; future: LayoutComponentDef[] }

export function ComponentEditor({ initial, isNew, others, screens, onSave, onClose }: ComponentEditorProps) {
  // 保存済みの差し込み口の ID・種類は、使っている画面の args が参照するため変えられない
  const [lockedParams, setLockedParams] = useState<Set<string>>(() => new Set(isNew ? [] : initial.params.map((q) => q.id)));
  const histRef = useRef<History>({ past: [], present: initial, future: [] });
  const pendingBase = useRef<LayoutComponentDef | null>(null);
  const [, rerender] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const def = histRef.current.present;
  const dirty = JSON.stringify(def) !== JSON.stringify(savedSnapshot);

  const setHist = (h: History) => { histRef.current = h; rerender((x) => x + 1); };
  /** commitNow=false は入力途中 (履歴に積まない)。確定時に編集前の状態を 1 件積む */
  const applyDef = useCallback((fn: (d: LayoutComponentDef) => LayoutComponentDef, commitNow = true) => {
    const h = histRef.current;
    const next = fn(h.present);
    if (!commitNow) {
      if (!pendingBase.current) pendingBase.current = h.present;
      setHist({ ...h, present: next });
      return;
    }
    const base = pendingBase.current ?? h.present;
    pendingBase.current = null;
    setHist({ past: [...h.past, base], present: next, future: [] });
  }, []);
  const commit = useCallback(() => {
    const h = histRef.current;
    if (!pendingBase.current) return;
    const base = pendingBase.current;
    pendingBase.current = null;
    setHist({ past: [...h.past, base], present: h.present, future: [] });
  }, []);
  const undo = () => { const h = histRef.current; if (!h.past.length) return; setHist({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }); };
  const redo = () => { const h = histRef.current; if (!h.future.length) return; setHist({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }); };

  const doc = useMemo(() => toDoc(def), [def]);
  const apply = useCallback((fn: (d: LayoutDoc) => LayoutDoc, commitNow = true) => {
    applyDef((cur) => fromDoc(fn(toDoc(cur)), cur), commitNow);
  }, [applyDef]);

  const nodes = def.nodes;
  const items = doc.items;
  // 入れ子にできる他の独自部品。自分自身は含めない (循環を避ける)
  const pool = useMemo(() => [...others.filter((c) => c.id !== def.id), def], [others, def]);
  const ops = useLayoutOps({ apply, nodes, items, tables: [], components: pool, selectedId, setSelectedId });

  const defIssues = useMemo(() => validateComponentDefs([...others.filter((c) => c.id !== def.id), def]).filter((i) => i.componentId === def.id), [others, def]);
  const layoutIssues = useMemo(() => validateLayoutWithComponents({ version: 1, nodes }, items, pool).filter((i) => i.severity !== "info" && i.code !== "unplaced-item"), [nodes, items, pool]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of layoutIssues) if (i.nodeId && m.get(i.nodeId) !== "error") m.set(i.nodeId, i.severity as "error" | "warning");
    return m;
  }, [layoutIssues]);
  const blocking = defIssues.filter((i) => i.severity === "error");

  const save = async () => {
    if (blocking.length || !def.label.trim()) return;
    setSaving(true); setError(null);
    try { await onSave(def); setSavedSnapshot(def); setLockedParams(new Set(def.params.map((q) => q.id))); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  const tryClose = () => { if (!dirty || window.confirm("保存していない変更があります。破棄して閉じますか？")) onClose(); };

  const selected = selectedId ? ops.selected : null;
  const screenNameById = useMemo(() => new Map(screens.map((s) => [s.id, s.name])), [screens]);
  const count = useMemo(() => { let n = 0; walkLayout(nodes, () => { n++; }); return n; }, [nodes]);

  return (
    <div className="sld-modal-backdrop sld-modal-wide" role="presentation">
      <div className="sld-modal sld-editor-modal" role="dialog" aria-modal="true" aria-label={`独自部品「${def.label}」の編集`} data-testid="component-editor">
        <header className="sld-modal-head sld-editor-head">
          <div className="sld-editor-title">
            <i className="bi bi-puzzle" />
            <input className="sld-input" aria-label="独自部品の名前" value={def.label} onChange={(e) => applyDef((d) => ({ ...d, label: e.target.value }), false)} onBlur={commit} data-testid="component-label" />
            <code title="部品 ID">{def.id}</code>
          </div>
          <div className="sld-editor-actions">
            <button type="button" className="sld-icon-btn" title="元に戻す" disabled={!histRef.current.past.length} onClick={undo}><i className="bi bi-arrow-counterclockwise" /></button>
            <button type="button" className="sld-icon-btn" title="やり直す" disabled={!histRef.current.future.length} onClick={redo}><i className="bi bi-arrow-clockwise" /></button>
            <button type="button" className="sld-btn sld-btn-primary" disabled={saving || !dirty || blocking.length > 0 || !def.label.trim()} onClick={() => { save().catch(console.error); }} data-testid="component-save">
              <i className="bi bi-check2" /> {saving ? "保存中…" : dirty ? "保存" : "保存済み"}
            </button>
            <button type="button" className="sld-btn" onClick={tryClose} data-testid="component-close">閉じる</button>
          </div>
        </header>
        {error && <div className="sld-inline-issue sld-issue-error">{error}</div>}
        <div className="sld-body sld-editor-body">
          <LayoutPalette
            editable
            nodes={nodes}
            items={items}
            tables={[]}
            selectedId={selectedId}
            onAdd={(t) => ops.addNode(t)}
            onPlaceItem={(id) => ops.placeItem(id)}
            onAddColumn={() => undefined}
            onSelect={setSelectedId}
            components={pool.filter((c) => c.id !== def.id)}
            onAddComponent={(id) => ops.addComponent(id)}
          />
          <main className="sld-center" aria-label={`${def.label} (${count} 部品)`}>
            <LayoutCanvas
              nodes={nodes}
              items={items}
              width={760}
              density="standard"
              showNotes={false}
              selectedId={selected ? selectedId : null}
              editable
              screenNameById={screenNameById}
              issuesByNode={issuesByNode}
              components={pool}
              onSelect={setSelectedId}
              onDrop={ops.handleDrop}
            />
          </main>
          {selected ? (
            <LayoutInspector
              editable
              node={selected}
              nodes={nodes}
              items={items}
              issues={layoutIssues}
              screens={screens}
              onNodeChange={(id, fn, c) => applyDef((d) => ({ ...d, nodes: updateNode(d.nodes, id, fn) }), c)}
              onItemChange={() => undefined}
              onRenameNode={ops.renameNode}
              onMove={ops.moveSelected}
              onDuplicate={ops.duplicateSelected}
              onDelete={ops.deleteSelected}
              onAddChild={ops.addChild}
              onSelect={setSelectedId}
              onCommit={commit}
              components={pool}
              onSetArg={(id, paramId, value, c) => applyDef((d) => ({ ...d, nodes: updateNode(d.nodes, id, (n) => {
                const args = { ...(n.args ?? {}) };
                if (value === "") delete args[paramId]; else args[paramId] = value;
                const out: LayoutNode = { ...n, args };
                if (!Object.keys(args).length) delete out.args;
                return out;
              }) }), c)}
              paramChips={def.params}
              hideItemEditor
            />
          ) : (
            <ParamsPanel
              def={def}
              lockedParams={lockedParams}
              issues={[...defIssues.map((i) => ({ severity: i.severity, message: i.message })), ...layoutIssues.map((i) => ({ severity: i.severity, message: i.message }))]}
              onChange={applyDef}
              onCommit={commit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ParamsPanel({ def, lockedParams, issues, onChange, onCommit }: {
  def: LayoutComponentDef; lockedParams: Set<string>;
  issues: Array<{ severity: string; message: string }>;
  onChange: (fn: (d: LayoutComponentDef) => LayoutComponentDef, commitNow?: boolean) => void;
  onCommit: () => void;
}) {
  const setParam = (id: string, patch: Partial<LayoutComponentParam>, commitNow = true) =>
    onChange((d) => ({ ...d, params: d.params.map((q) => (q.id === id ? { ...q, ...patch } : q)) }), commitNow);
  const addParam = () => onChange((d) => {
    let n = d.params.length + 1;
    while (d.params.some((q) => q.id === `param${n}`)) n++;
    return { ...d, params: [...d.params, { id: `param${n}`, label: `差し込み口 ${n}`, kind: "text" as const }] };
  });
  return (
    <aside className="sld-right" aria-label="差し込み口">
      <div className="sld-right-body" data-testid="component-params">
        <h3 className="sld-panel-title">差し込み口</h3>
        <p className="sld-hint">画面ごとに変えたい箇所です。画面項目は左の「項目」から入力欄などにドラッグ、文言は部品を選んで「差し込み口を使う」から入れます。</p>
        {def.params.length === 0 && <p className="sld-hint">差し込み口はありません。どの画面でも同じ内容の部品になります。</p>}
        {def.params.map((q) => {
          const locked = lockedParams.has(q.id);
          return (
            <div key={q.id} className="sld-param-card" data-testid={`component-param-${q.id}`}>
              <div className="sld-row-2">
                <div className="sld-row">
                  <label className="sld-field-label">表示名</label>
                  <input className="sld-input" value={q.label} onChange={(e) => setParam(q.id, { label: e.target.value }, false)} onBlur={onCommit} />
                </div>
                <div className="sld-row">
                  <label className="sld-field-label">ID</label>
                  <input className="sld-input sld-mono" value={q.id} disabled={locked}
                    title={locked ? "登録済みの差し込み口の ID は、使っている画面が参照しているため変えられません" : undefined}
                    onChange={(e) => onChange((d) => (/^[a-z][A-Za-z0-9]*$/.test(e.target.value) && !d.params.some((x) => x.id === e.target.value) ? renameComponentParam(d, q.id, e.target.value) : d), false)} onBlur={onCommit} />
                </div>
              </div>
              <div className="sld-row-2">
                <div className="sld-row">
                  <label className="sld-field-label">種類</label>
                  <select className="sld-input" value={q.kind} disabled={locked} onChange={(e) => setParam(q.id, { kind: e.target.value as LayoutComponentParamKind })}>
                    {(Object.keys(KIND_LABEL) as LayoutComponentParamKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </div>
                {q.kind !== "item" && (
                  <div className="sld-row">
                    <label className="sld-field-label">既定値</label>
                    <input className="sld-input" value={q.default ?? ""} onChange={(e) => setParam(q.id, { default: e.target.value || undefined }, false)} onBlur={onCommit} />
                  </div>
                )}
              </div>
              <button type="button" className="sld-icon-btn danger" title="この差し込み口を削除" disabled={locked} onClick={() => onChange((d) => ({ ...d, params: d.params.filter((x) => x.id !== q.id) }))}>
                <i className="bi bi-trash" />
              </button>
            </div>
          );
        })}
        <button type="button" className="sld-btn" onClick={addParam} data-testid="component-add-param"><i className="bi bi-plus" /> 差し込み口を追加</button>

        <h4 className="sld-group-title">説明・分類</h4>
        <div className="sld-row">
          <label className="sld-field-label">分類</label>
          <input className="sld-input" value={def.category ?? ""} onChange={(e) => onChange((d) => ({ ...d, category: e.target.value || undefined }), false)} onBlur={onCommit} />
        </div>
        <div className="sld-row">
          <label className="sld-field-label">説明</label>
          <textarea className="sld-input" rows={3} value={def.description ?? ""} onChange={(e) => onChange((d) => ({ ...d, description: e.target.value || undefined }), false)} onBlur={onCommit} />
        </div>

        {issues.length > 0 && <h4 className="sld-group-title">要確認</h4>}
        <ul className="sld-issues" data-testid="component-issues">
          {issues.map((i, k) => <li key={k} className={`sld-issue sld-issue-${i.severity}`}><span><i className={`bi ${i.severity === "error" ? "bi-x-circle" : "bi-exclamation-triangle"}`} /> {i.message}</span></li>)}
        </ul>
      </div>
    </aside>
  );
}
