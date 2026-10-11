/**
 * 通知 (utils/toast.ts) の表示。画面の下に数秒だけ出す。スクリーンリーダーには role=status で伝える。
 */
import { useEffect, useState } from "react";
import { subscribeToasts, type ToastMessage } from "../../utils/toast";
import "../../styles/toast.css";

const SHOWN_MS = 2600;

export function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = subscribeToasts((t) => {
      setItems((cur) => [...cur.slice(-2), t]);
      const timer = setTimeout(() => { timers.delete(timer); setItems((cur) => cur.filter((x) => x.id !== t.id)); }, SHOWN_MS);
      timers.add(timer);
    });
    return () => { off(); timers.forEach(clearTimeout); };
  }, []);
  if (items.length === 0) return <div className="toast-host" role="status" aria-live="polite" />;
  return (
    <div className="toast-host" role="status" aria-live="polite" data-testid="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} data-testid="toast">
          <i className={`bi ${t.kind === "success" ? "bi-check-circle-fill" : t.kind === "error" ? "bi-exclamation-octagon-fill" : "bi-info-circle-fill"}`} /> {t.text}
        </div>
      ))}
    </div>
  );
}
