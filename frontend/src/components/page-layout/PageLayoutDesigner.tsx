/**
 * PageLayoutDesigner — ページレイアウト ビジュアルデザイン画面 (pl-3, #1024)
 *
 * ScreenDesigner.tsx を base に editorKind で GrapesJS / Puck を分岐。
 * pl-5 (#1026): GrapesJS 経路に region gadget injection (composition プレビュー) を追加。
 */

import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPageLayout } from "../../store/pageLayoutStore";
import type { PageLayout } from "../../store/pageLayoutStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { Designer } from "../Designer";
import type { Editor as GEditor } from "grapesjs";
import { injectGadgetPreviews, clearGadgetPreviews } from "../../utils/pageLayoutCompositionPreview";

export function PageLayoutDesigner() {
  const { pageLayoutId } = useParams<{ pageLayoutId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [pl, setPl] = useState<PageLayout | null | undefined>(undefined); // undefined = loading

  // GrapesJS editor ref (region injection 用、pl-5)
  const grapesEditorRef = useRef<GEditor | null>(null);
  const plRef = useRef<PageLayout | null>(null);

  useEffect(() => {
    if (!pageLayoutId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- route param absence immediately resolves the loading sentinel.
      setPl(null);
      return;
    }

    let mounted = true;

    const doLoad = () => {
      loadPageLayout(pageLayoutId).then((data) => {
        if (!mounted) return;
        setPl(data ?? null);
        plRef.current = data ?? null;
        // assignments が変わったら再 inject
        if (grapesEditorRef.current && data) {
          _injectWithEditor(grapesEditorRef.current, data);
        }
      }).catch(() => { if (mounted) setPl(null); });
    };

    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) doLoad();
    });

    mcpBridge.startWithoutEditor();
    doLoad();

    return () => {
      mounted = false;
      unsubStatus();
    };
  }, [pageLayoutId]);

  /**
   * GrapesJS editor ready 後に region injection を実行する。
   * component:add イベントで region が後から追加された場合にも再 inject する。
   */
  const handleGrapesEditorReady = useCallback((editor: GEditor) => {
    grapesEditorRef.current = editor;
    if (plRef.current) {
      // canvas 初期 load 完了を待ってから inject (component 描画が settleするまで少し待つ)
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          _injectWithEditor(grapesEditorRef.current, plRef.current);
        }
      }, 300);
    }

    // region ブロックが canvas に追加されたとき再 inject
    const onComponentAdd = () => {
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          clearGadgetPreviews(grapesEditorRef.current);
          _injectWithEditor(grapesEditorRef.current, plRef.current);
        }
      }, 50);
    };
    editor.on("component:add", onComponentAdd);
    // cleanup は Designer の unmount 時に editor も unmount されるので editor.off は不要だが念のため
  }, []);

  if (pl === undefined) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 16,
        fontFamily: "system-ui, sans-serif", color: "#64748b",
      }}>
        <div className="spinner" />
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!pageLayoutId || !pl) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 16,
        fontFamily: "system-ui, sans-serif", color: "#64748b",
      }}>
        <i className="bi bi-exclamation-triangle" style={{ fontSize: 48, color: "#f59e0b" }} />
        <h2 style={{ margin: 0, color: "#334155" }}>ページレイアウトが見つかりません</h2>
        <p>指定された ID のページレイアウトは存在しないか、削除されています。</p>
        <button
          onClick={() => navigate(wsPath("/page-layout/list"))}
          style={{
            padding: "8px 20px", border: "none", borderRadius: 6,
            background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 14,
          }}
        >
          <i className="bi bi-arrow-left" /> 一覧に戻る
        </button>
      </div>
    );
  }

  const editorKind = pl.design?.editorKind ?? "grapesjs";

  // editorKind='grapesjs': GrapesJS Designer に region drop slot ブロックを追加済み
  // (frontend/src/grapes/blocks.ts の CAT_REGIONS カテゴリ)
  // pl-5: onGrapesEditorReady で gadget injection を実行
  if (editorKind === "grapesjs") {
    return (
      <Designer
        screenId={`page-layout:${pageLayoutId}`}
        screenName={pl.name}
        onBack={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
        onGrapesEditorReady={handleGrapesEditorReady}
      />
    );
  }

  // editorKind='puck': Puck Editor (pl-5 #1026: region 一覧 + assignments 表示)
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", flexDirection: "column", gap: 16,
      fontFamily: "system-ui, sans-serif", color: "#64748b",
    }}>
      <i className="bi bi-layout-wtf" style={{ fontSize: 48, color: "#6366f1" }} />
      <h2 style={{ margin: 0, color: "#334155" }}>{pl.name} — Puck レイアウトデザイン</h2>
      <p style={{ fontSize: 13, color: "#94a3b8" }}>composition プレビュー (pl-5 #1026)</p>
      <div style={{
        border: "2px dashed #e2e8f0", borderRadius: 8, padding: "24px 40px",
        textAlign: "center", maxWidth: 560,
      }}>
        <p style={{ margin: "0 0 12px 0", fontWeight: 600, fontSize: 14 }}>Region 割り当て一覧</p>
        {(pl.regions ?? []).map((r) => {
          const assignedId = pl.assignments?.[r.name];
          return (
            <div key={r.name} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", border: "1px dashed #cbd5e1",
              borderRadius: 4, marginBottom: 4, background: "#f8fafc",
            }}>
              <code style={{ fontSize: 12, fontWeight: 600, color: "#6366f1", minWidth: 80 }}>{r.name}</code>
              {r.name === "main" ? (
                <span style={{ fontSize: 12, color: "#f59e0b" }}>
                  content slot (page Screen 本文がここに嵌まる)
                </span>
              ) : assignedId ? (
                <span style={{ fontSize: 12, color: "#10b981" }}>
                  gadget: <code style={{ fontSize: 11 }}>{assignedId}</code>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "#94a3b8" }}>未割り当て</span>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
        style={{
          padding: "8px 20px", border: "none", borderRadius: 6,
          background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 14,
        }}
      >
        <i className="bi bi-arrow-left" /> 構造編集に戻る
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: GrapesJS editor に gadget preview を inject する
// ---------------------------------------------------------------------------

async function _injectWithEditor(editor: GEditor, pl: PageLayout): Promise<void> {
  try {
    const project = await loadProject();
    const screens = project.screens.map((s) => ({ id: s.id, name: s.name }));
    injectGadgetPreviews(editor, pl.assignments ?? {}, screens);
  } catch (e) {
    console.warn("[PageLayoutDesigner] gadget inject failed:", e);
  }
}
