import { ChangesHost } from "./editing/ChangesHost";
import type { ReactNode } from "react";
import { HeaderMenu } from "./HeaderMenu";
import { WorkspaceIndicator } from "./workspace/WorkspaceIndicator";
import { CodexIndicator } from "./codex/CodexIndicator";
import { ThemeToggle } from "./common/ThemeToggle";
import { QuickOpen } from "./quick-open/QuickOpen";
import { ShortcutHelp } from "./help/ShortcutHelp";
import { ConnectionStatus } from "./common/ConnectionStatus";
import { ToastHost } from "./common/ToastHost";
import { UserNameButton } from "./common/UserNameButton";
import { NotificationHistory } from "./common/NotificationHistory";
import { DisplaySettings } from "./common/DisplaySettings";
import { FavoritesMenu } from "./common/FavoritesMenu";
import { ReplaceDialog } from "./replace/ReplaceDialog";
import { TourHost } from "./help/Tour";
import "../styles/commonHeader.css";

interface Props {
  notification?: ReactNode;
}

export function CommonHeader({ notification }: Props) {
  return (
    <header className="common-header">
      <div className="common-header-left">
        <HeaderMenu />
        <i className="bi bi-palette2 common-header-logo" />
        <span className="common-header-title">Harnize Harmony</span>
        <WorkspaceIndicator />
      </div>
      <div className="common-header-center">
        <ConnectionStatus />
        {notification}
      </div>
      <div className="common-header-right">
        <QuickOpen />
        <FavoritesMenu />
        <NotificationHistory />
        <ShortcutHelp />
        <ThemeToggle />
        <DisplaySettings />
        <CodexIndicator />
        <UserNameButton />
      </div>
      <ReplaceDialog />
      <TourHost />
      <ToastHost />
      <ChangesHost />
    </header>
  );
}
