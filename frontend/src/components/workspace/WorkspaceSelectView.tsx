import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getState,
  subscribe as subscribeStore,
  loadWorkspaces,
  isWorkspaceRequestInFlight,
  openWorkspace,
} from "../../store/workspaceStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { AddWorkspaceDialog } from "./WorkspaceListView";

export function WorkspaceSelectView() {
  const navigate = useNavigate();
  const [state, setState] = useState(getState());
  const [showAdd, setShowAdd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeStore(() => setState(getState()));
  }, []);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    // onStatusChange は登録時に現在ステータスで即時発火する (mcpBridge.ts の仕様)。
    // 「既接続」状態での即時発火時に loadWorkspaces() を呼ぶと、AppShell が既に実施した
    // load と 2 重になる。loadWorkspaces() は loading=true を立てるため AppShell の
    // スプラッシュが再表示 → WorkspaceSelectView アンマウント → 再マウント → 再び即時発火
    // という無限ループを引き起こす (#806 PR #813 修正)。
    //
    // 対策: 最初の即時発火 (prev=null の時) は「load が必要かどうか」を判定してから呼ぶ。
    // 「load が必要」= まだ loading 中 or workspaces 未取得 (AppShell の load が未完了)。
    // 再接続イベント (disconnected → connected の遷移) は常に reload する。
    let prevStatus: string | null = null;
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      const isReconnect = prevStatus !== null && prevStatus !== "connected" && s === "connected";
      prevStatus = s;
      if (s !== "connected") return;
      if (!isReconnect) {
        // 初回即時発火: AppShell が既に load 完了している場合は skip して 2 重 load を防ぐ。
        // 一覧取得 / open が実行中なら、その完了で state が更新されるので重ねて取得しない
        // (open 中の splash で本画面が再マウントされるたびに取得が重なっていた)
        const { loading } = getState();
        if (!loading || isWorkspaceRequestInFlight()) return;
      }
      loadWorkspaces().catch(console.error);
    });
    return () => { unsubStatus(); };
  }, []);

  const { workspaces, lockdown } = state;
  const recentWorkspaces = workspaces.slice(0, 5);
  const hiddenCount = workspaces.length - 5;
  const visibleError = actionError ?? (state.error === "e2e bypass" ? null : state.error);

  const handleOpenById = async (id: string) => {
    setActionError(null);
    try {
      await openWorkspace(id, true);
      navigate("/", { replace: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--hm-bg)",
      color: "var(--hm-fg)",
      padding: "32px",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "520px",
        background: "var(--hm-surface)",
        borderRadius: "12px",
        padding: "40px",
        border: "1px solid var(--hm-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <i className="bi bi-folder2-open" style={{ fontSize: "3rem", color: "color-mix(in srgb, var(--hm-hue-blue) 70%, var(--hm-fg))", display: "block", marginBottom: "12px" }} />
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--hm-fg)", margin: 0 }}>
            Harmony プロジェクトを開いてください
          </h2>
          <p style={{ color: "var(--hm-fg-muted)", fontSize: "0.9rem", marginTop: "8px" }}>
            Harmony 本体 repo の外にある project フォルダを明示的に選択してください
          </p>
        </div>

        {visibleError && (
          <div style={{
            padding: "8px 12px",
            background: "color-mix(in srgb, var(--hm-hue-red) 15%, transparent)",
            border: "1px solid rgba(248,113,113,0.4)",
            borderRadius: "6px",
            color: "color-mix(in srgb, var(--hm-hue-red) 70%, var(--hm-fg))",
            fontSize: "0.85rem",
            marginBottom: "20px",
          }}>
            <i className="bi bi-exclamation-circle" /> {visibleError}
          </div>
        )}

        {/* プロジェクトを開く / 作成 */}
        {!lockdown && (
          <button
            onClick={() => setShowAdd(true)}
            data-testid="workspace-open-or-create"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              padding: "12px 16px",
              background: "var(--hm-accent-solid)",
              border: "none",
              borderRadius: "6px",
              color: "var(--hm-on-solid)",
              fontWeight: 600,
              fontSize: "0.95rem",
              cursor: "pointer",
              marginBottom: "16px",
            }}
          >
            <i className="bi bi-folder2-open" />
            プロジェクトを開く / 作成
          </button>
        )}

        {/* 探索ルートと最近使った project */}
        {!lockdown && (
          <button
            onClick={() => navigate("/workspace/list")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              padding: "12px 16px",
              background: "transparent",
              border: "1px solid var(--hm-border)",
              borderRadius: "6px",
              color: "var(--hm-fg)",
              fontWeight: 500,
              fontSize: "0.95rem",
              cursor: "pointer",
              marginBottom: "16px",
            }}
          >
            <i className="bi bi-list-ul" style={{ color: "color-mix(in srgb, var(--hm-hue-blue) 70%, var(--hm-fg))" }} />
            探索ルート / 最近使った project
          </button>
        )}

        {/* 最近使ったワークスペース */}
        {recentWorkspaces.length > 0 && !lockdown && (
          <div>
            <div style={{
              fontSize: "0.78rem",
              color: "var(--hm-fg-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}>
              最近使ったワークスペース
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {recentWorkspaces.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleOpenById(w.id)}
                  title={w.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    width: "100%",
                    padding: "9px 12px",
                    background: "transparent",
                    border: "1px solid var(--hm-border)",
                    borderRadius: "5px",
                    color: "var(--hm-fg)",
                    fontSize: "0.88rem",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <i className="bi bi-folder2" style={{ color: "color-mix(in srgb, var(--hm-hue-blue) 70%, var(--hm-fg))", flexShrink: 0 }} />
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {w.name}
                    </div>
                    <div style={{
                      fontSize: "0.76rem",
                      color: "var(--hm-fg-muted)",
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {w.path}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {/* D: 5 件超のヒントリンク */}
            {hiddenCount > 0 && (
              <button
                onClick={() => navigate("/workspace/list")}
                style={{
                  marginTop: "8px",
                  background: "none",
                  border: "none",
                  color: "color-mix(in srgb, var(--hm-hue-blue) 70%, var(--hm-fg))",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  padding: "2px 0",
                  textAlign: "left",
                  textDecoration: "underline",
                }}
              >
                他 {hiddenCount} 件はワークスペース一覧へ
              </button>
            )}
          </div>
        )}

        {lockdown && (
          <div style={{
            padding: "10px 14px",
            background: "color-mix(in srgb, var(--hm-hue-amber) 12%, transparent)",
            border: "1px solid rgba(251,191,36,0.4)",
            borderRadius: "6px",
            color: "color-mix(in srgb, var(--hm-hue-amber) 70%, var(--hm-fg))",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <i className="bi bi-lock-fill" />
            環境変数 DESIGNER_DATA_DIR で固定中のため、ワークスペース切替はできません
          </div>
        )}
      </div>

      {showAdd && (
        <AddWorkspaceDialog
          onClose={() => setShowAdd(false)}
          onAdded={() => navigate("/", { replace: true })}
        />
      )}
    </div>
  );
}
