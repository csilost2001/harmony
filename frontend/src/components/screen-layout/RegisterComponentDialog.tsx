/**
 * 選択した部品 (と中の部品) を、プロジェクト独自部品として登録するダイアログ。
 * 名前・ID・分類・説明を決め、画面ごとに変えたい箇所 (画面項目・文言・遷移先) を
 * 「差し込み口」として選ぶ。登録すると、元の部品は独自部品の参照に置き換わる。
 */
import { useMemo, useState } from "react";
import {
  LAYOUT_NODE_LABELS, buildComponentDef, suggestParams, validateComponentDefs,
  type LayoutComponentDef, type LayoutItemLike, type LayoutNode, type ParamCandidate,
} from "@harmony/shared";
import { toCamel } from "./layoutModel";

export interface RegisterComponentDialogProps {
  node: LayoutNode;
  items: LayoutItemLike[];
  existing: LayoutComponentDef[];
  onRegister: (def: LayoutComponentDef, args: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const KIND_LABEL = { item: "画面項目", text: "文言", screen: "遷移先画面" } as const;

interface Row { candidate: ParamCandidate; on: boolean; paramId: string; label: string }

export function RegisterComponentDialog({ node, items, existing, onRegister, onCancel }: RegisterComponentDialogProps) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState(() => {
    const base = kebab(node.id) || "my-component";
    let n = base; let k = 2;
    while (existing.some((c) => c.id === n)) n = `${base}-${k++}`;
    return n;
  });
  const [idTouched, setIdTouched] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => suggestParams([node], items).map((c) => ({
    candidate: c,
    on: c.suggested,
    paramId: c.kind === "item" ? (toCamel(c.itemRef ?? "") || "item") : (toCamel(`${c.nodeId}-${c.prop}`) || "text"),
    label: c.kind === "item" ? c.label : c.label.replace(/:.*$/, ""),
  })));

  const picked = rows.filter((r) => r.on);
  const paramIdErrors = useMemo(() => {
    const seen = new Set<string>();
    return picked.map((r) => {
      const bad = !/^[a-z][A-Za-z0-9]*$/.test(r.paramId) ? "英小文字で始まる英数字で入力してください" : seen.has(r.paramId) ? "他の差し込み口と重複しています" : null;
      seen.add(r.paramId);
      return bad;
    });
  }, [picked]);

  const idError = !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id) ? "小文字英数字とハイフン (例: search-box) で入力してください"
    : existing.some((c) => c.id === id) ? `「${id}」は既に登録されています` : null;
  const canSave = !!label.trim() && !idError && paramIdErrors.every((e) => !e) && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      const { def, args } = buildComponentDef({
        id, label: label.trim(), category: category.trim() || undefined, description: description.trim() || undefined,
        nodes: [node],
        params: picked.map((r) => ({ candidate: r.candidate, paramId: r.paramId, label: r.label.trim() || r.paramId })),
      });
      const problems = validateComponentDefs([...existing, def]).filter((p) => p.severity === "error" && p.componentId === def.id);
      if (problems.length) { setError(problems[0].message); return; }
      await onRegister(def, args);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sld-modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="sld-modal" role="dialog" aria-modal="true" aria-labelledby="sld-reg-title" onClick={(e) => e.stopPropagation()} data-testid="register-component-dialog">
        <header className="sld-modal-head">
          <h3 id="sld-reg-title"><i className="bi bi-puzzle" /> 独自部品として登録</h3>
          <button type="button" className="sld-icon-btn" onClick={onCancel} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </header>
        <div className="sld-modal-body">
          <p className="sld-hint">
            選択中の{LAYOUT_NODE_LABELS[node.type]}「{node.id}」を、他の画面でも使える部品として登録します。登録すると、この画面の部品は独自部品の参照に置き換わります。
          </p>
          <div className="sld-row-2">
            <div className="sld-row">
              <label className="sld-field-label" htmlFor="reg-label">名前</label>
              <input id="reg-label" className="sld-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: キーワード検索" autoFocus data-testid="register-label" />
            </div>
            <div className="sld-row">
              <label className="sld-field-label" htmlFor="reg-id">部品 ID</label>
              <input id="reg-id" className="sld-input sld-mono" value={id} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} data-testid="register-id" />
              {idError && idTouched && <div className="sld-error-text">{idError}</div>}
            </div>
          </div>
          <div className="sld-row-2">
            <div className="sld-row">
              <label className="sld-field-label" htmlFor="reg-cat">分類 (任意)</label>
              <input id="reg-cat" className="sld-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例: 検索" />
            </div>
            <div className="sld-row">
              <label className="sld-field-label" htmlFor="reg-desc">説明 (任意)</label>
              <input id="reg-desc" className="sld-input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <h4 className="sld-group-title">画面ごとに変えたい箇所 (差し込み口)</h4>
          {rows.length === 0 ? <p className="sld-hint">差し込み口にできる箇所がありません。そのまま登録すると、どの画面でも同じ内容になります。</p> : (
            <table className="sld-cols-table" data-testid="register-params">
              <thead><tr><th aria-label="選ぶ" /><th>種類</th><th>現在の値</th><th>差し込み口 ID</th><th>表示名</th></tr></thead>
              <tbody>
                {rows.map((r, k) => {
                  const pickedIndex = picked.indexOf(r);
                  const err = pickedIndex >= 0 ? paramIdErrors[pickedIndex] : null;
                  return (
                    <tr key={k}>
                      <td><input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, on: e.target.checked } : x)))} aria-label={`${r.candidate.label} を差し込み口にする`} data-testid={`register-param-on-${k}`} /></td>
                      <td>{KIND_LABEL[r.candidate.kind]}</td>
                      <td><code>{r.candidate.value}</code></td>
                      <td>
                        <input className="sld-input sld-mono" value={r.paramId} disabled={!r.on} aria-label="差し込み口 ID" onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, paramId: e.target.value } : x)))} />
                        {err && <div className="sld-error-text">{err}</div>}
                      </td>
                      <td><input className="sld-input" value={r.label} disabled={!r.on} aria-label="表示名" onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {error && <div className="sld-inline-issue sld-issue-error">{error}</div>}
        </div>
        <footer className="sld-modal-foot">
          <button type="button" className="sld-btn" onClick={onCancel}>キャンセル</button>
          <button type="button" className="sld-btn sld-btn-primary" disabled={!canSave} onClick={() => { submit().catch(console.error); }} data-testid="register-submit">
            <i className="bi bi-check2" /> 登録して置き換える
          </button>
        </footer>
      </div>
    </div>
  );
}
