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
  navigate?: (path: string) => void;
}

interface UseFlowProjectSyncResult {
  serverChanged: boolean;
  dismissServerBanner: () => void;
}

export function useFlowProjectSync({
  reload,
  isDirtyRef,
  navigate,
}: UseFlowProjectSyncOptions): UseFlowProjectSyncResult {
  const [serverChanged, setServerChanged] = useState(false);

  const dismissServerBanner = useCallback(() => {
    setServerChanged(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    setFlowDraftMode(true);

    const unsubDraft = subscribeToFlowDraftSaves(() => {
      isDirtyRef.current = true;
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
  }, [isDirtyRef, navigate, reload]);

  return { serverChanged, dismissServerBanner };
}
