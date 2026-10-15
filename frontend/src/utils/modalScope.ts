/** ダイアログ (aria-modal) が開いているか・その中か。ダイアログの外へ作用するキー (F6 / Ctrl+Alt+M など) を、止めるために使う */
const MODAL = '[aria-modal="true"]';

export function hasOpenModal(doc: Document = document): boolean {
  return doc.querySelector(MODAL) !== null;
}

export function isInsideModal(el: Element | null | undefined): boolean {
  return !!el?.closest?.(MODAL);
}
