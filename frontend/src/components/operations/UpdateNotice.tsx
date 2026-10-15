/** 更新の案内: 前回このブラウザで見た版と違えば、「更新されました」と知らせる (初回は知らせない)。見た版は、このブラウザにだけ保存する */
import { useEffect } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { opsApi } from "../../utils/opsApi";
import { markVersionSeen, readSeenVersion, versionChanged } from "../../utils/updateNotice";
import { showToast } from "../../utils/toast";

export function UpdateNotice() {
  useEffect(() => {
    let done = false;
    const check = () => {
      if (done) return;
      opsApi.version().then((v) => {
        if (done) return;
        done = true;
        if (versionChanged(v, readSeenVersion())) showToast(`Harmony が更新されました (版 ${v.version}${v.commit ? `・${v.commit}` : ""})。更新内容は、メニューの「連携と運用」→「版と更新」で見られます`, "info");
        markVersionSeen(v);
      }).catch(() => undefined); // 版の案内に失敗しても、利用者の操作には関係ない
    };
    mcpBridge.startWithoutEditor();
    if (mcpBridge.getStatus() === "connected") check();
    const unsub = mcpBridge.onStatusChange((s) => { if (s === "connected") check(); });
    return () => { done = true; unsub(); };
  }, []);
  return null;
}
