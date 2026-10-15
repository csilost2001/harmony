import { describe, it, expect } from "vitest";
import { collectRegions, currentRegionIndex, nextRegionIndex, focusRegion } from "./regions";

function mount() {
  document.body.innerHTML = `
    <header class="common-header"><button id="hb">menu</button></header>
    <nav class="tabbar"><a href="#t">tab</a></nav>
    <main id="app-main">
      <section data-region="一覧"><input id="i1" /></section>
      <section data-region="詳細"><div id="plain">no focusable</div></section>
      <section data-region="隠れた領域" hidden><input id="i3" /></section>
    </main>`;
}

describe("regions", () => {
  it("ヘッダー → タブ → data-region の順に集め、隠れているものは除く", () => {
    mount();
    expect(collectRegions().map((r) => r.name)).toEqual(["ヘッダー", "タブ", "一覧", "詳細"]);
  });

  it("領域の中で、最初にフォーカスできるものに移る。無ければ領域そのもの", () => {
    mount();
    const regions = collectRegions();
    focusRegion(regions[2]);
    expect(document.activeElement?.id).toBe("i1");
    focusRegion(regions[3]);
    expect(document.activeElement).toBe(regions[3].el);
    focusRegion(regions[0]);
    expect(document.activeElement?.id).toBe("hb");
  });

  it("いまの領域の番号 (どこにも無ければ -1) と、次・前の番号 (巡回)", () => {
    mount();
    const regions = collectRegions();
    expect(currentRegionIndex(regions, document.body)).toBe(-1);
    expect(currentRegionIndex(regions, document.getElementById("i1"))).toBe(2);
    expect(nextRegionIndex(4, -1, 1)).toBe(0);
    expect(nextRegionIndex(4, -1, -1)).toBe(3);
    expect(nextRegionIndex(4, 3, 1)).toBe(0);
    expect(nextRegionIndex(4, 0, -1)).toBe(3);
    expect(nextRegionIndex(0, -1, 1)).toBe(-1);
  });

  it("入れ子の領域は、いちばん内側を返す", () => {
    document.body.innerHTML = `<main id="app-main"><div data-region="外"><div data-region="内"><input id="x" /></div></div></main>`;
    const regions = collectRegions();
    expect(regions[currentRegionIndex(regions, document.getElementById("x"))].name).toBe("内");
  });
});
