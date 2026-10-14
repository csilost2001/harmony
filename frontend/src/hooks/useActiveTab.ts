import { useSyncExternalStore } from "react";
import { getActiveTabId, getTabs, subscribe, type TabItem } from "../store/tabStore";

const snapshot = (): TabItem | null => {
  const id = getActiveTabId();
  return getTabs().find((t) => t.id === id) ?? null;
};

/** いま表示しているタブ (無ければ null) */
export function useActiveTab(): TabItem | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
