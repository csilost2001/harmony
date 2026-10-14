/**
 * ヘッダーのパネル (通知の履歴・表示の設定・検索置換) を、コマンドパレットなどほかの場所から開くための合図。
 */
export type HeaderPanelName = "notifications" | "display" | "replace" | "tour" | "review";
const EVENT = "harmony:open-header-panel";

export function requestHeaderPanel(name: HeaderPanelName): void {
  window.dispatchEvent(new CustomEvent<HeaderPanelName>(EVENT, { detail: name }));
}

/** 指定のパネルを開く合図を待つ。戻り値で解除する */
export function onHeaderPanelRequest(name: HeaderPanelName, handler: () => void): () => void {
  const listener = (e: Event) => { if ((e as CustomEvent<HeaderPanelName>).detail === name) handler(); };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** キーの押下を、画面全体 (window) のショートカットへ届ける。コマンドパレットから「保存」などを実行するのに使う */
export function pressShortcut(init: { key: string; ctrlKey?: boolean; shiftKey?: boolean }): void {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
}
