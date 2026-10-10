/**
 * DesignerTabHost — 画面デザインタブ。
 *
 * AppShell の designTabs.map() で render される。画面デザインは業務部品デザイナ
 * (ScreenLayoutDesigner) だけで行う。旧エディタ (GrapesJS / Puck) は廃止済みで、
 * 旧形式のデザインを持つ画面は業務部品デザイナの開始画面から自動変換する。
 */
import { ScreenLayoutDesigner } from "./screen-layout/ScreenLayoutDesigner";

export interface DesignerTabHostProps {
  screenId: string;
  screenName?: string;
  isActive?: boolean;
}

export function DesignerTabHost({ screenId, screenName, isActive }: DesignerTabHostProps) {
  return <ScreenLayoutDesigner screenId={screenId} screenName={screenName} isActive={isActive} />;
}
