import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getState,
  subscribe as subscribeStore,
  openWorkspace,
  closeWorkspace,
} from "../../store/workspaceStore";

export function WorkspaceIndicator() {
  const [state, setState] = useState(getState());
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    return subscribeStore(() => setState(getState()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const { active, lockdown, workspaces } = state;
  const recentWorkspaces = workspaces.slice(0, 5);

  const handleNavigateToList = () => {
    setOpen(false);
    navigate("/workspace/list");
  };

  const handleOpenWorkspace = async (id: string) => {
    setOpen(false);
    try {
      await openWorkspace(id, true);
      navigate("/", { replace: true });
    } catch (e) {
      console.error("[WorkspaceIndicator] openWorkspace failed:", e);
    }
  };

  /** 新しいブラウザタブで指定 workspace を開く (#703 R-5 C-1) */
  const handleOpenInNewTab = (id: string) => {
    setOpen(false);
    // ユーザー操作直接の click handler から呼ぶため popup blocker 回避
    window.open(`/w/${id}/`, "_blank");
  };

  const handleClose = async () => {
    setOpen(false);
    try {
      await closeWorkspace();
    } catch (e) {
      console.error("[WorkspaceIndicator] closeWorkspace failed:", e);
    }
  };

  return (
    <div
      ref={dropdownRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title={
          lockdown
            ? `環境変数 DESIGNER_DATA_DIR で固定中: ${state.lockdownPath ?? ""}`
            : active?.path
            ? active.path
            : "ワークスペース未選択"
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          background: "transparent",
          border: "1px solid #3b3e55",
          borderRadius: "4px",
          padding: "3px 8px",
          cursor: "pointer",
          color: active ? "#e4e6f0" : "#9a9db5",
          fontSize: "12px",
          whiteSpace: "nowrap",
          maxWidth: "220px",
        }}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {lockdown ? (
          <i className="bi bi-lock-fill" style={{ color: "#fbbf24" }} />
        ) : (
          <i className="bi bi-folder2" style={{ color: "#4dabf7" }} />
        )}
        <span
          data-testid="workspace-indicator-name"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "160px",
            opacity: active ? 1 : 0.6,
          }}
        >
          {active?.name ?? (active?.path ? active.path : "ワークスペース未選択")}
        </span>
        <i className="bi bi-chevron-down" style={{ fontSize: "10px", opacity: 0.7 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: "260px",
          background: "#1e2035",
          border: "1px solid #3b3e55",
          borderRadius: "6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          zIndex: 9999,
          padding: "4px 0",
        }}>
          {/* ワークスペース一覧を開く */}
          <button
            onClick={handleNavigateToList}
            style={menuItemStyle}
          >
            <i className="bi bi-folder2-open" style={{ marginRight: "8px", color: "#4dabf7" }} />
            ワークスペース一覧を開く
          </button>

          {/* 最近使ったワークスペース (lockdown 時は非表示) */}
          {!lockdown && recentWorkspaces.length > 0 && (
            <>
              <div style={sectionLabelStyle}>最近使ったワークスペース</div>
              {recentWorkspaces.map((w) => (
                <div key={w.id} style={{ display: "flex", alignItems: "center", width: "100%" }}>
                  <button
                    onClick={() => handleOpenWorkspace(w.id)}
                    style={{
                      ...menuItemStyle,
                      flex: 1,
                      fontWeight: active?.id === w.id ? 600 : undefined,
                    }}
                    title={w.path}
                  >
                    {active?.id === w.id && (
                      <i className="bi bi-check2" style={{ marginRight: "4px", color: "#4ade80" }} />
                    )}
                    {active?.id !== w.id && (
                      <span style={{ display: "inline-block", width: "18px" }} />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {w.name}
                    </span>
                  </button>
                  {/* 新しいブラウザタブで開く (#703 R-5 C-1) */}
                  <button
                    onClick={() => handleOpenInNewTab(w.id)}
                    title="新しいブラウザタブで開く"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#9a9db5",
                      padding: "7px 8px",
                      fontSize: "11px",
                      flexShrink: 0,
                    }}
                  >
                    <i className="bi bi-box-arrow-up-right" />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* セパレーター */}
          <div style={{ height: "1px", background: "#3b3e55", margin: "4px 0" }} />

          {/* ワークスペースを閉じる */}
          <button
            onClick={handleClose}
            disabled={!active || lockdown}
            style={{
              ...menuItemStyle,
              color: (!active || lockdown) ? "#666" : "#f87171",
              cursor: (!active || lockdown) ? "not-allowed" : "pointer",
            }}
          >
            <i className="bi bi-x-circle" style={{ marginRight: "8px" }} />
            ワークスペースを閉じる
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "7px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "#e4e6f0",
  fontSize: "12px",
  textAlign: "left",
};

const sectionLabelStyle: React.CSSProperties = {
  padding: "6px 12px 2px",
  fontSize: "10px",
  color: "#9a9db5",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
