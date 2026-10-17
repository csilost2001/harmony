/** 領域へフォーカスを移す。移せたら true */
export function focusRegion(selector: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) return false;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: false });
  return document.activeElement === el;
}


