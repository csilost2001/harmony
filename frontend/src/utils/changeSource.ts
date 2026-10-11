/**
 * 「保存前の変更点」を見せるための、編集中の文書の登録簿。
 * useResourceEditor が、読み込んだ (または最後に保存した) 内容と、いまの内容を取り出す関数を、タブ ID で登録する。
 * 変更点の表示 (ChangesHost) が、いま開いているタブの分を引く。
 */
export interface ChangeSource {
  /** 読み込んだ (または最後に保存した) 内容 */
  getBefore: () => unknown;
  /** いまの内容 */
  getAfter: () => unknown;
}

const sources = new Map<string, ChangeSource>();

export function registerChangeSource(tabId: string, source: ChangeSource): () => void {
  sources.set(tabId, source);
  return () => { if (sources.get(tabId) === source) sources.delete(tabId); };
}

export function getChangeSource(tabId: string): ChangeSource | undefined {
  return sources.get(tabId);
}

/** 「変更点」ボタンが送る合図 (ChangesHost が受けて開く) */
export const SHOW_CHANGES_EVENT = "harmony:show-changes";
export function requestShowChanges(): void {
  window.dispatchEvent(new CustomEvent(SHOW_CHANGES_EVENT));
}
