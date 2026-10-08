/**
 * 独自部品の管理 (一覧・新規作成・編集・削除)。画面デザイナの「独自部品の管理…」から開く。
 * 一覧には、それぞれの部品を使っている画面・部品の数を出し、使用中の部品は削除前に確認する。
 */
import { useCallback, useEffect, useState } from "react";
import { validateComponentDefs, type LayoutComponentDef } from "@harmony/shared";
import {
  deleteLayoutComponent, findLayoutComponentUsages, saveLayoutComponent, useLayoutComponents, type LayoutComponentUsages,
} from "../../store/layoutComponentStore";
import { ComponentEditor } from "./ComponentEditor";

export interface ComponentManagerProps {
  /** 開いた直後に編集する部品 (画面デザイナの「定義を編集」から) */
  initialEditId?: string;
  screens: Array<{ id: string; name: string }>;
  onClose: () => void;
}

export function ComponentManager({ initialEditId, screens, onClose }: ComponentManagerProps) {
  const { components, loaded } = useLayoutComponents();
  const [editing, setEditing] = useState<{ def: LayoutComponentDef; isNew: boolean } | null>(null);
  const [usages, setUsages] = useState<Record<string, LayoutComponentUsages>>({});
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newId, setNewId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    Promise.all(components.map(async (c) => [c.id, await findLayoutComponentUsages(c.id)] as const))
      .then((rows) => { if (alive) setUsages(Object.fromEntries(rows)); })
      .catch(console.error);
    return () => { alive = false; };
  }, [components, loaded]);

  // 画面デザイナの「定義を編集」から開いたときは、一覧を挟まず編集画面を開く
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!loaded || opened || !initialEditId) return;
    const def = components.find((c) => c.id === initialEditId);
    if (def) setEditing({ def, isNew: false });
    setOpened(true);
  }, [loaded, opened, initialEditId, components]);

  const idError = newId && (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(newId) ? "小文字英数字とハイフン (例: search-box) で入力してください" : components.some((c) => c.id === newId) ? `「${newId}」は既に登録されています` : null);
  const canCreate = !!newLabel.trim() && !!newId && !idError;

  const onSave = useCallback(async (def: LayoutComponentDef) => {
    const errors = validateComponentDefs([...components.filter((c) => c.id !== def.id), def]).filter((i) => i.severity === "error" && i.componentId === def.id);
    if (errors.length) throw new Error(errors[0].message);
    await saveLayoutComponent(def);
  }, [components]);

  const remove = async (c: LayoutComponentDef) => {
    const res = await deleteLayoutComponent(c.id);
    if (res.deleted) { setMessage(`独自部品「${c.label}」を削除しました。`); return; }
    const where = [...res.usages.screens.map((s) => `画面「${screens.find((x) => x.id === s)?.name ?? s}」`), ...res.usages.components.map((x) => `独自部品「${components.find((y) => y.id === x)?.label ?? x}」`)].join("、");
    if (window.confirm(`「${c.label}」は ${where} で使われています。削除すると、これらの部品は定義が見つからない状態になります。削除しますか？`)) {
      await deleteLayoutComponent(c.id, true);
      setMessage(`独自部品「${c.label}」を削除しました。使っていた部品は「定義が見つかりません」と表示されます。`);
    }
  };

  if (editing) {
    return (
      <ComponentEditor
        initial={editing.def}
        isNew={editing.isNew}
        others={components}
        screens={screens}
        onSave={onSave}
        onClose={() => { setEditing(null); if (initialEditId) onClose(); }}
      />
    );
  }

  return (
    <div className="sld-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="sld-modal" role="dialog" aria-modal="true" aria-labelledby="sld-mgr-title" onClick={(e) => e.stopPropagation()} data-testid="component-manager">
        <header className="sld-modal-head">
          <h3 id="sld-mgr-title"><i className="bi bi-puzzle" /> プロジェクト独自部品</h3>
          <button type="button" className="sld-icon-btn" onClick={onClose} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </header>
        <div className="sld-modal-body">
          <p className="sld-hint">このプロジェクト専用の部品です。部品の見た目と、画面ごとに変える箇所 (差し込み口) を一度決めておけば、どの画面にも同じ部品として置けます。定義を直すと、使っている全画面に反映されます。</p>
          {message && <div className="sld-notice" role="status"><i className="bi bi-info-circle" /><span>{message}</span></div>}
          {!loaded ? <p className="sld-hint">読み込み中…</p> : components.length === 0 ? (
            <p className="sld-hint" data-testid="component-empty">独自部品はまだありません。下の「新規作成」で作るか、画面の部品を選んで「独自部品として登録」してください。</p>
          ) : (
            <table className="sld-cols-table" data-testid="component-list">
              <thead><tr><th>名前</th><th>ID</th><th>差し込み口</th><th>使用箇所</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {components.map((c) => {
                  const u = usages[c.id];
                  return (
                    <tr key={c.id} data-testid={`component-row-${c.id}`}>
                      <td><b>{c.label}</b>{c.category && <span className="sld-chip-static">{c.category}</span>}{c.description && <div className="sld-hint">{c.description}</div>}</td>
                      <td><code>{c.id}</code></td>
                      <td>{c.params.length}</td>
                      <td>{u ? `${u.screens.length} 画面${u.components.length ? ` / ${u.components.length} 部品` : ""}` : "…"}</td>
                      <td className="sld-row-actions">
                        <button type="button" className="sld-btn" onClick={() => setEditing({ def: c, isNew: false })} data-testid={`component-edit-${c.id}`}><i className="bi bi-pencil-square" /> 編集</button>
                        <button type="button" className="sld-icon-btn danger" title="削除" onClick={() => { remove(c).catch(console.error); }} data-testid={`component-delete-${c.id}`}><i className="bi bi-trash" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h4 className="sld-group-title">新規作成</h4>
          {!creating ? (
            <button type="button" className="sld-btn" onClick={() => setCreating(true)} data-testid="component-new"><i className="bi bi-plus-lg" /> 空の独自部品を作る</button>
          ) : (
            <div className="sld-row-2" data-testid="component-new-form">
              <div className="sld-row">
                <label className="sld-field-label" htmlFor="mgr-new-label">名前</label>
                <input id="mgr-new-label" className="sld-input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例: 注文サマリ" autoFocus data-testid="component-new-label" />
              </div>
              <div className="sld-row">
                <label className="sld-field-label" htmlFor="mgr-new-id">部品 ID</label>
                <input id="mgr-new-id" className="sld-input sld-mono" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="例: order-summary" data-testid="component-new-id" />
                {idError && <div className="sld-error-text">{idError}</div>}
              </div>
              <div className="sld-row">
                <button type="button" className="sld-btn sld-btn-primary" disabled={!canCreate} data-testid="component-new-submit"
                  onClick={() => setEditing({ def: { id: newId, label: newLabel.trim(), params: [], nodes: [] }, isNew: true })}>
                  <i className="bi bi-pencil-square" /> 作って編集する
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
