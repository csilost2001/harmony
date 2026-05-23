/**
 * FragmentsPanel — Screen が使用する ui-fragment instance 一覧の編集パネル (#1281)。
 *
 * Screen.fragments[] (ScreenFragmentInstance[]) の CRUD + fragmentRef 補完 +
 * broken / 重複 inline warning を提供。ScreenItemsView.tsx 内に collapsible panel として挿入。
 *
 * 参考: schemas/v3/screen.v3.schema.json#/$defs/ScreenFragmentInstance
 *       docs/spec/generic-definition-layer.md §3.6
 */
import { useState, useMemo } from "react";
import type { ScreenFragmentInstance } from "../../../../types/v3";
import { useWorkspaceReferences } from "../../../../hooks/useWorkspaceReferences";
import { fragmentRefResolver, FRAGMENT_REF_PREFIX } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";

interface Props {
  fragments: ScreenFragmentInstance[];
  /** テキスト変更時の silent update (per-keystroke、undo stack に積まない) */
  onChange: (next: ScreenFragmentInstance[] | undefined) => void;
  /** 構造変更 (add/remove) 完了時の commit trigger */
  onCommit: () => void;
  readonly: boolean;
  defaultExpanded?: boolean;
}

export function FragmentsPanel({ fragments, onChange, onCommit, readonly, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const workspace = useWorkspaceReferences();

  const fragmentNameSet = useMemo(
    () => new Set(workspace.fragments.map((f) => f.name)),
    [workspace.fragments],
  );

  /** catalog 不在の fragmentRef を持つ index の集合 (空文字は「未入力」扱い、broken 対象外) */
  const brokenIdx = useMemo(() => {
    const broken = new Set<number>();
    fragments.forEach((f, i) => {
      if (!f.fragmentRef) return; // 空文字は broken 扱いしない (新規追加直後の視覚ノイズ抑制)
      const m = f.fragmentRef.match(/^generic-definitions\/ui-fragment\/([A-Za-z][A-Za-z0-9_]*)$/);
      if (!m || !fragmentNameSet.has(m[1])) broken.add(i);
    });
    return broken;
  }, [fragments, fragmentNameSet]);

  /** (fragmentRef, instanceId) ペアが重複している index の集合 */
  const dupIdx = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    fragments.forEach((f, i) => {
      const key = `${f.fragmentRef}:${f.instanceId ?? ""}`;
      const prev = seen.get(key);
      if (prev !== undefined) {
        dups.add(i);
        dups.add(prev);
      } else {
        seen.set(key, i);
      }
    });
    return dups;
  }, [fragments]);

  const updateAt = (i: number, patch: Partial<ScreenFragmentInstance>) => {
    const next = fragments.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(next);
  };

  const removeAt = (i: number) => {
    const next = fragments.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : undefined);
    onCommit(); // 削除は undo 単位として記録する
  };

  const add = () => {
    onChange([...fragments, { fragmentRef: "" }]);
    onCommit(); // 追加は undo 単位として記録する
  };

  return (
    <div className="catalog-panel fragments-panel">
      <button
        type="button"
        className="catalog-panel-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
        <i className="bi bi-puzzle" />
        {" "}使用する UI fragment ({fragments.length} 件)
        {brokenIdx.size > 0 && (
          <span className="badge bg-warning text-dark ms-2">
            broken {brokenIdx.size}
          </span>
        )}
      </button>
      {expanded && (
        <div className="catalog-panel-body">
          {fragments.length === 0 && (
            <div className="catalog-empty">使用中の fragment はありません。</div>
          )}
          {fragments.map((f, i) => (
            <div className="catalog-row fragments-panel-row" key={`${i}-${f.fragmentRef}`}>
              <div className="catalog-row-fields">
                <label className="catalog-wide">
                  <span>fragmentRef</span>
                  <ReferenceCompletionInput
                    className="form-control form-control-sm"
                    value={f.fragmentRef}
                    onValueChange={(v) => updateAt(i, { fragmentRef: v })}
                    resolvers={[fragmentRefResolver]}
                    ctx={{ fieldKind: "fragmentRef", workspace }}
                    placeholder={`例: ${FRAGMENT_REF_PREFIX}messageArea`}
                    style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
                    disabled={readonly}
                  />
                </label>
                <label>
                  <span>instanceId</span>
                  <input
                    className="form-control form-control-sm"
                    value={f.instanceId ?? ""}
                    onChange={(e) => updateAt(i, { instanceId: e.target.value || undefined })}
                    placeholder="例: errorArea"
                    disabled={readonly}
                  />
                </label>
                <label>
                  {brokenIdx.has(i) && (
                    <i
                      className="bi bi-exclamation-triangle text-warning"
                      title="catalog に存在しない fragmentRef"
                    />
                  )}
                  {dupIdx.has(i) && (
                    <i
                      className="bi bi-exclamation-triangle text-warning"
                      title="(fragmentRef, instanceId) ペアが重複"
                    />
                  )}
                  {!readonly && (
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger"
                      onClick={() => removeAt(i)}
                      title="削除"
                    >
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </label>
              </div>
            </div>
          ))}
          {!readonly && (
            <div className="catalog-row catalog-row-add">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={add}>
                <i className="bi bi-plus-lg" /> 追加
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
