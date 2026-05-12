/**
 * RegionContext — PageLayout composition preview 用の Context。
 *
 * PageLayoutDesigner の Puck 経路で RegionProvider を wrap し、
 * 各 Region primitive が assignments と gadget Puck data を参照できるようにする。
 *
 * pl-5 follow-up (#1026): Puck composition preview (feature parity)
 * pl-6 (Codex H-2): Puck Config も Context で渡して Render の循環依存を回避
 */

import { createContext, useContext } from "react";
import type { Config } from "@measured/puck";

export interface RegionContextValue {
  /** regionName → gadget screenId のマッピング (PageLayout.assignments) */
  assignments: Record<string, string>;
  /** gadget screenId → Puck data (未割り当てや未ロードは undefined) */
  gadgetData: Record<string, unknown>;
  /**
   * RFC #1021 pl-6 (Codex H-2): Puck Config を Context で渡し、
   * Region primitive が `<Render config={...} data={gadgetData} />` を呼べるようにする。
   * buildConfig は Region primitive を import するため、Region 側で buildConfig を直接
   * import すると ES module の循環依存になる。Context 経由なら回避できる。
   *
   * `null` の場合は config 未注入 (PageLayout 外で使われる時) → Render しない。
   */
  puckConfig?: Config | null;
}

const RegionContext = createContext<RegionContextValue | null>(null);

export const RegionProvider = RegionContext.Provider;

/** assignments を取得する hook。未 wrap 時は空 object を返す。 */
export function usePageLayoutAssignments(): Record<string, string> {
  return useContext(RegionContext)?.assignments ?? {};
}

/**
 * 指定した gadget screenId の Puck data を取得する hook。
 * 未割り当て・未ロード・RegionContext 外のいずれかの場合は null を返す。
 */
export function useGadgetPuckData(gadgetScreenId?: string): unknown | null {
  const ctx = useContext(RegionContext);
  if (!gadgetScreenId || !ctx) return null;
  return ctx.gadgetData[gadgetScreenId] ?? null;
}

/** RFC #1021 pl-6 (Codex H-2): Region 内で nested Render に使う Puck Config を取得 */
export function usePuckConfig(): Config | null {
  return useContext(RegionContext)?.puckConfig ?? null;
}
