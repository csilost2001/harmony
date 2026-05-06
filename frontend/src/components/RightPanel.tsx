import { useState, useEffect, useRef, useCallback } from "react";
import { useEditorMaybe } from "@grapesjs/react";
import { A11yPanel } from "./A11yPanel";
import { isNamableElement, getItemIdPrefix, getExistingNamesFromEditor } from "../grapes/dataItemId";
import { generateAutoId } from "../utils/screenItemNaming";
import { mcpBridge } from "../mcp/mcpBridge";
import { loadScreenItems, saveScreenItems } from "../store/screenItemsStore";
import type { Identifier } from "../types/v3";

type TabId = "styles" | "traits" | "layers" | "a11y";

export interface RightPanelProps {
  screenId?: string;
}

/**
 * GrapesJS のネイティブ UI を render() メソッドで取得し、
 * React の ref コンテナにマウントするコンポーネント。
 *
 * <Canvas/> 使用時は GrapesJS のパネルシステムが無効化されるため、
 * @grapesjs/react の Provider + Container パターンは空になる。
 * 代わりに各マネージャーの render() を直接呼び出す。
 */
export function RightPanel({ screenId }: RightPanelProps) {
  const [tab, setTab] = useState<TabId>("styles");
  const editor = useEditorMaybe();
  const [loaded, setLoaded] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  /** 選択中のフォーム要素の name 属性 (namable でなければ null) */
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);

  /** ID リセット確認ダイアログ */
  const [pendingReset, setPendingReset] = useState<{
    oldId: string;
    newId: string;
    affectedGroups: Array<{ id: string; name: string; refCount: number }>;
    totalRefs: number;
  } | null>(null);

  const selectorRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const traitRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // editor:load 後にマネージャーの render() を呼ぶ
  useEffect(() => {
    if (!editor) return;

    const onLoad = () => setLoaded(true);

    // 既にロード済みならすぐセット。editor が半壊状態（初期化中 or 破損データで
    // Canvas.init が失敗した直後）でも throw しないよう防御する (#131)。
    try {
      const comps = editor.getComponents?.();
      const styles = editor.getStyle?.();
      if ((comps && comps.length > 0) || (styles && styles.length > 0)) {
        setLoaded(true);
      }
    } catch {
      /* editor 未初期化は load イベントで拾う */
    }
    editor.on("load", onLoad);
    return () => {
      editor.off("load", onLoad);
    };
  }, [editor]);

  // コンポーネント選択状態を追跡
  useEffect(() => {
    if (!editor) return;
    const onToggle = () => {
      const sel = editor.getSelected();
      setHasSelection(!!sel);
      if (sel && isNamableElement(sel)) {
        const name = String(sel.getAttributes?.()?.name ?? "");
        setSelectedItemName(name || null);
      } else {
        setSelectedItemName(null);
      }
    };
    editor.on("component:toggled", onToggle);
    return () => {
      editor.off("component:toggled", onToggle);
    };
  }, [editor]);

  // ロード完了後にネイティブ UI をマウント
  useEffect(() => {
    if (!editor || !loaded || mountedRef.current) return;
    mountedRef.current = true;

    // Selector Manager
    if (selectorRef.current) {
      const el = editor.SelectorManager.render([]);
      selectorRef.current.appendChild(el);
    }

    // Style Manager
    if (styleRef.current) {
      const el = editor.StyleManager.render();
      styleRef.current.appendChild(el);
    }

    // Trait Manager
    if (traitRef.current) {
      const el = editor.TraitManager.render();
      traitRef.current.appendChild(el);
    }

    // Layer Manager
    if (layerRef.current) {
      const el = editor.LayerManager.render();
      layerRef.current.appendChild(el);
    }
  }, [editor, loaded]);

  const handleResetId = useCallback(async () => {
    if (!editor || !screenId || !selectedItemName) return;
    const sel = editor.getSelected();
    if (!sel || !isNamableElement(sel)) return;

    const prefix = getItemIdPrefix(sel);
    const existingNames = getExistingNamesFromEditor(editor);
    // 自分自身を除いてから次の連番を計算
    const othersNames = existingNames.filter((n) => n !== selectedItemName);
    const newId = generateAutoId(prefix, othersNames);

    try {
      const result = await mcpBridge.request("checkScreenItemRefs", {
        screenId,
        itemId: selectedItemName,
      }) as { affectedProcessFlows: Array<{ id: string; name: string; refCount: number }>; totalRefs: number };

      if (result.totalRefs === 0) {
        await mcpBridge.request("renameScreenItem", { screenId, oldId: selectedItemName, newId });
        // GrapesJS インメモリも更新 (autosave による上書きを防ぐ)
        sel.addAttributes({ name: newId, id: newId });
        setSelectedItemName(newId);
      } else {
        setPendingReset({
          oldId: selectedItemName,
          newId,
          affectedGroups: result.affectedProcessFlows,
          totalRefs: result.totalRefs,
        });
      }
    } catch {
      // MCP 未接続: GrapesJS インメモリと screen-items localStorage を直接更新
      sel.addAttributes({ name: newId, id: newId });
      setSelectedItemName(newId);
      try {
        const siFile = await loadScreenItems(screenId);
        const item = siFile.items.find((it) => it.id === selectedItemName);
        if (item) {
          item.id = newId as Identifier;
          await saveScreenItems(siFile);
        }
      } catch {
        // localStorage 更新失敗は無視 (GrapesJS 更新だけで続行)
      }
    }
  }, [editor, screenId, selectedItemName]);

  const handleConfirmReset = useCallback(async () => {
    if (!pendingReset || !screenId || !editor) return;
    const { oldId, newId } = pendingReset;
    setPendingReset(null);
    try {
      await mcpBridge.request("renameScreenItem", { screenId, oldId, newId });
      // GrapesJS インメモリも更新 (autosave による上書きを防ぐ)
      const sel = editor.getSelected();
      if (sel && isNamableElement(sel)) {
        sel.addAttributes({ name: newId, id: newId });
      }
      setSelectedItemName(newId);
    } catch (e) {
      alert(`IDリセットに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [pendingReset, screenId, editor]);

  return (
    <div className="right-panel">
      <div className="right-tabs">
        <button
          className={tab === "styles" ? "active" : ""}
          onClick={() => setTab("styles")}
        >
          <i className="bi bi-brush" /> スタイル
        </button>
        <button
          className={tab === "traits" ? "active" : ""}
          onClick={() => setTab("traits")}
        >
          <i className="bi bi-sliders" /> 属性
        </button>
        <button
          className={tab === "layers" ? "active" : ""}
          onClick={() => setTab("layers")}
        >
          <i className="bi bi-stack" /> レイヤー
        </button>
        <button
          className={tab === "a11y" ? "active" : ""}
          onClick={() => setTab("a11y")}
          title="アクセシビリティ"
        >
          <i className="bi bi-universal-access" /> a11y
        </button>
      </div>

      <div className="right-content">
        <div hidden={tab !== "styles"}>
          {!hasSelection && (
            <div className="right-panel-empty">
              <i className="bi bi-cursor" />
              <p>コンポーネントを選択してください</p>
            </div>
          )}
          <div style={{ display: hasSelection ? undefined : "none" }}>
            <div className="panel-block">
              <div className="panel-block-title">セレクタ</div>
              <div ref={selectorRef} />
            </div>
            <div className="panel-block">
              <div className="panel-block-title">スタイル</div>
              <div ref={styleRef} />
            </div>
          </div>
        </div>
        <div hidden={tab !== "traits"}>
          {!hasSelection && (
            <div className="right-panel-empty">
              <i className="bi bi-cursor" />
              <p>コンポーネントを選択してください</p>
            </div>
          )}
          <div style={{ display: hasSelection ? undefined : "none" }}>
            <div className="panel-block">
              <div className="panel-block-title">属性</div>
              <div ref={traitRef} />
            </div>
            {screenId && selectedItemName && (
              <div className="panel-block">
                <div className="panel-block-title">画面項目 ID</div>
                <div className="px-2 py-1" style={{ fontSize: "0.8rem" }}>
                  <div className="d-flex align-items-center gap-2">
                    <code className="text-truncate flex-1" style={{ maxWidth: "10em" }} title={selectedItemName}>
                      {selectedItemName}
                    </code>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={handleResetId}
                      title="IDを自動採番形式にリセット"
                    >
                      <i className="bi bi-arrow-counterclockwise me-1" />
                      IDをリセット
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div hidden={tab !== "layers"}>
          <div className="panel-block">
            <div className="panel-block-title">レイヤー</div>
            <div ref={layerRef} />
          </div>
        </div>
        <div hidden={tab !== "a11y"}>
          <A11yPanel />
        </div>
      </div>

      {pendingReset && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.45)" }} role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">IDリセットの確認</h5>
              </div>
              <div className="modal-body">
                <p>
                  <code className="me-1">{pendingReset.oldId}</code>
                  <span className="me-1">→</span>
                  <code>{pendingReset.newId}</code>
                </p>
                <p className="mb-1">
                  以下の処理フロー ({pendingReset.affectedGroups.length} 件、計 {pendingReset.totalRefs} 箇所) の参照が自動追従されます:
                </p>
                <ul className="mb-0">
                  {pendingReset.affectedGroups.map((ag) => (
                    <li key={ag.id}>{ag.name}（{ag.refCount} 箇所）</li>
                  ))}
                </ul>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPendingReset(null)}>
                  キャンセル
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmReset}>
                  リセット実行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
