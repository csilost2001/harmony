import type { ReactNode } from "react";
import { HeaderMenu } from "./HeaderMenu";
import { WorkspaceIndicator } from "./workspace/WorkspaceIndicator";
import { CodexIndicator } from "./codex/CodexIndicator";
import "../styles/commonHeader.css";

interface Props {
  notification?: ReactNode;
  userName?: string;
}

export function CommonHeader({ notification, userName }: Props) {
  return (
    <header className="common-header">
      <div className="common-header-left">
        <HeaderMenu />
        <i className="bi bi-palette2 common-header-logo" />
        <span className="common-header-title">Harnize Harmony</span>
        <WorkspaceIndicator />
      </div>
      <div className="common-header-center">
        {notification}
      </div>
      <div className="common-header-right">
        <CodexIndicator />
        <span className="common-header-user">
          <i className="bi bi-person-circle" />
          <span className="common-header-user-label">{userName ?? "ゲスト"}</span>
        </span>
      </div>
    </header>
  );
}
