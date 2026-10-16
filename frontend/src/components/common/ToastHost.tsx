/**
 * 通知 (utils/toast.ts) の表示。画面の下に数秒だけ出す。スクリーンリーダーには role=status で伝える。
 */
import { useEffect, useState } from "react";
import { decideToast, getNotifyPrefs } from "../../utils/notifyPrefs";
import { runToastRetry, subscribeToasts, type ToastMessage } from "../../utils/toast";
import "../../styles/toast.css";

const SHOWN_MS = 2600;
/** やり直せる失敗は、押す時間のために長めに出す */
const SHOWN_WITH_RETRY_MS = 9000;
/** 「まとめて出す」の通知を、最初のものから、この時間だけ貯めて、1 つにして出す */
const BATCH_MS = 4000;
let batchSeq = 0;

export function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const present = (t: ToastMessage) => {
      setItems((cur) => [...cur.slice(-2), t]);
      const timer = setTimeout(() => { timers.delete(timer); setItems((cur) => cur.filter((x) => x.id !== t.id)); }, t.retry ? SHOWN_WITH_RETRY_MS : SHOWN_MS);
      timers.add(timer);
    };
    let batched = 0;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeToasts((t) => {
      // 通知の受け取り方 (ヘッダーの通知の履歴で選ぶ)。出さない・まとめる通知も、履歴には残っている
      const how = decideToast(getNotifyPrefs(), t.kind, new Date());
      if (how === "hide") return;
      if (how === "batch") {
        batched++;
        batchTimer ??= setTimeout(() => {
          const n = batched; batched = 0; batchTimer = undefined;
          present({ id: -(++batchSeq), text: `${n} 件の通知をまとめました (ヘッダーの「通知の履歴」で見られます)`, kind: "info", at: Date.now() });
        }, BATCH_MS);
        return;
      }
      present(t);
    });
    return () => { off(); timers.forEach(clearTimeout); clearTimeout(batchTimer); };
  }, []);
  if (items.length === 0) return <div className="toast-host" role="status" aria-live="polite" />;
  return (
    <div className="toast-host" role="status" aria-live="polite" data-testid="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} data-testid="toast">
          <i className={`bi ${t.kind === "success" ? "bi-check-circle-fill" : t.kind === "error" ? "bi-exclamation-octagon-fill" : "bi-info-circle-fill"}`} /> {t.text}
          {t.retry && (
            <button type="button" className="toast-retry" data-testid="toast-retry"
              onClick={() => { setItems((cur) => cur.filter((x) => x.id !== t.id)); runToastRetry(t.id); }}>再試行</button>
          )}
        </div>
      ))}
    </div>
  );
}
