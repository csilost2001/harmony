import { useEffect } from "react";
import { collectRegions, currentRegionIndex, focusRegion, nextRegionIndex } from "../../utils/regions";

/** F6 / Shift+F6 で、画面の領域 (ヘッダー・タブ・一覧・詳細・マーカーなど) を順に移る。画面には何も描かない。 */
export function RegionNavigator() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.ctrlKey || e.altKey || e.metaKey) return;
      const regions = collectRegions();
      if (regions.length === 0) return;
      e.preventDefault();
      const at = nextRegionIndex(regions.length, currentRegionIndex(regions, document.activeElement), e.shiftKey ? -1 : 1);
      const r = regions[at];
      focusRegion(r);
      // どの領域に移ったか分かるように、枠をしばらく光らせる
      r.el.classList.add("hm-region-flash");
      r.el.setAttribute("data-region-flash", r.name);
      setTimeout(() => { r.el.classList.remove("hm-region-flash"); r.el.removeAttribute("data-region-flash"); }, 900);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
