import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { mcpBridge } from "../mcp/mcpBridge";
import {
  setFlowDraftMode,
  subscribeToFlowDraftSaves,
} from "../store/flowStore";
import { hasDraft } from "../utils/draftStorage";
import { acknowledgeServerMtime, hasServerBeenUpdated } from "../utils/serverMtime";

interface UseFlowProjectSyncOptions {
  reload: () => Promise<void>;
  isDirtyRef: MutableRefObject<boolean>;
  setIsDirty: (dirty: boolean) => void;
  navigate?: (path: string) => void;
}

interface UseFlowProjectSyncResult {
  serverChanged: boolean;
  dismissServerBanner: () => void;
  /**
   * Phase I round 3+4 SF-2 (Codex round 3/4 S-2): 外部 source からも banner を立てられるよう、
   * 同 hook 内の `handleExternalChange` 相当 effect を公開する。
   * FlowEditor が entity 別 broadcast (screen/table/processFlow/pageLayoutChanged) を購読し、
   * dirty 中は本 callback で serverChanged を立て、clean 時は別途 reload を実行する。
   */
  markExternalChangeForBanner: () => void;
}

export function useFlowProjectSync({
  reload,
  isDirtyRef,
  setIsDirty,
  navigate,
}: UseFlowProjectSyncOptions): UseFlowProjectSyncResult {
  const [serverChanged, setServerChanged] = useState(false);

  const dismissServerBanner = useCallback(() => {
    setServerChanged(false);
  }, []);

  /**
   * Phase I round 3+4 SF-2: 外部 hook 経由で banner を立てる callback。
   * isDirty に関係なく setServerChanged(true) を発火する (caller 側で dirty 判定する想定)。
   */
  const markExternalChangeForBanner = useCallback(() => {
    setServerChanged(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    setFlowDraftMode(true);

    const unsubDraft = subscribeToFlowDraftSaves(() => {
      isDirtyRef.current = true;
      setIsDirty(true);
    });

    const handleExternalChange = () => {
      if (!mounted) return;
      if (isDirtyRef.current) {
        setServerChanged(true);
      } else {
        reload().catch(console.error);
      }
    };

    mcpBridge.setNavigateHandler(navigate ? (path) => navigate(path) : null);
    mcpBridge.setFlowChangeHandler(handleExternalChange);

    const unsubProject = mcpBridge.onBroadcast("projectChanged", handleExternalChange);

    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) {
        if (isDirtyRef.current) {
          setServerChanged(true);
        } else {
          reload().catch(console.error);
        }
      }
    });

    mcpBridge.startWithoutEditor();

    reload().then(async () => {
      if (hasDraft("flow", "project")) {
        if (await hasServerBeenUpdated("project")) {
          if (mounted) setServerChanged(true);
        }
      } else {
        await acknowledgeServerMtime("project");
      }
    }).catch(console.error);

    return () => {
      mounted = false;
      setFlowDraftMode(false);
      mcpBridge.setNavigateHandler(null);
      mcpBridge.setFlowChangeHandler(null);
      unsubDraft();
      unsubProject();
      unsubStatus();
    };
  }, [isDirtyRef, navigate, reload, setIsDirty]);

  return { serverChanged, dismissServerBanner, markExternalChangeForBanner };
}
