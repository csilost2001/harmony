/**
 * 画面の下に短く出す通知 (保存しました など)。どこからでも showToast で出せる。表示は ToastHost。
 */
export type ToastKind = "success" | "info" | "error";
export interface ToastMessage { id: number; text: string; kind: ToastKind }

type Listener = (t: ToastMessage) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function showToast(text: string, kind: ToastKind = "success"): void {
  const t = { id: ++seq, text, kind };
  listeners.forEach((l) => l(t));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
