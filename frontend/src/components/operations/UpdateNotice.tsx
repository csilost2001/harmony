/** 更新の案内: 前回このブラウザで見た版と違えば、「更新されました」と知らせる (初回は知らせない)。見た版は、このブラウザにだけ保存する */
import { useEffect, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { opsApi } from "../../utils/opsApi";
import { markNoteSeen, markVersionSeen, pickNewNotes, readSeenNote, readSeenVersion, versionChanged, type ReleaseNoteLike } from "../../utils/updateNotice";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { showToast } from "../../utils/toast";

export function UpdateNotice() {
  const [fresh, setFresh] = useState<{ notes: ReleaseNoteLike[]; total: number } | null>(null);
  useEffect(() => {
    let done = false;
    const check = () => {
      if (done) return;
      opsApi.version().then((v) => {
        if (done) return;
        done = true;
        if (versionChanged(v, readSeenVersion())) showToast(`Harmony が更新されました (版 ${v.version}${v.commit ? `・${v.commit}` : ""})。更新内容は、メニューの「連携と運用」→「版と更新」で見られます`, "info");
        // 更新のあとの最初に、新しいリリースノートを 5 件までに絞って見せる (前に見た版が分かるときだけ。初回は出さない)
        const notes = v.notes ?? [];
        if (versionChanged(v, readSeenVersion())) {
          const picked = pickNewNotes(notes, readSeenNote());
          if (picked.length > 0) setFresh({ notes: picked, total: v.notesTotal ?? notes.length });
        }
        markNoteSeen(notes[0]);
        markVersionSeen(v);
      }).catch(() => undefined); // 版の案内に失敗しても、利用者の操作には関係ない
    };
    mcpBridge.startWithoutEditor();
    if (mcpBridge.getStatus() === "connected") check();
    const unsub = mcpBridge.onStatusChange((s) => { if (s === "connected") check(); });
    return () => { done = true; unsub(); };
  }, []);
  return fresh ? <WhatsNewDialog notes={fresh.notes} total={fresh.total} onClose={() => setFresh(null)} /> : null;
}
