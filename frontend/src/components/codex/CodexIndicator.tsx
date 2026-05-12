/**
 * ヘッダー右上に表示する Codex 接続/認証状態のインジケーター。
 *
 * 色:
 *   緑  authenticated
 *   黄  unauthenticated
 *   赤  no-cli / no-server / error
 *   灰  checking
 *
 * クリックで AI 設定画面へ遷移する。
 */

import { useNavigate } from "react-router-dom";
import { useCodexStatus } from "../../codex/useCodexStatus";
import "../../styles/codexSettings.css";

export function CodexIndicator() {
  const { status } = useCodexStatus();
  const navigate = useNavigate();

  const { color, label, icon } = describe(status.kind);

  return (
    <button
      className={`codex-indicator codex-indicator-${color}`}
      onClick={() => navigate("/ai-settings")}
      title={`AI 接続状態: ${label}`}
      aria-label={`AI 接続状態: ${label}`}
    >
      <i className={`bi ${icon}`} />
      <span className="codex-indicator-dot" />
    </button>
  );
}

function describe(kind: ReturnType<typeof useCodexStatus>["status"]["kind"]): {
  color: "green" | "yellow" | "red" | "gray";
  label: string;
  icon: string;
} {
  switch (kind) {
    case "authenticated":
      return { color: "green", label: "ログイン済", icon: "bi-robot" };
    case "unauthenticated":
      return { color: "yellow", label: "未ログイン", icon: "bi-robot" };
    case "no-cli":
      return { color: "red", label: "CLI 未検出", icon: "bi-robot" };
    case "no-server":
      return { color: "red", label: "サーバー未接続", icon: "bi-robot" };
    case "error":
      return { color: "red", label: "エラー", icon: "bi-robot" };
    case "checking":
    default:
      return { color: "gray", label: "確認中", icon: "bi-robot" };
  }
}
