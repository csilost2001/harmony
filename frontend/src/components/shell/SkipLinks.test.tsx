import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SkipLinks } from "./SkipLinks";
import { focusRegion } from "../../utils/focusRegion";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("SkipLinks (続編 第 10 弾 #181)", () => {
  it("本文・タブ・ヘッダーへのリンクが、この順に並ぶ", () => {
    render(<SkipLinks />);
    expect([...screen.getByTestId("skip-links").querySelectorAll("a")].map((a) => a.textContent)).toEqual(["本文へ移動", "タブへ移動", "ヘッダーへ移動"]);
  });
  it("押すと、その領域へフォーカスが移る (tabindex を付けて)。リンクの遷移はしない", () => {
    document.body.insertAdjacentHTML("beforeend", '<header class="common-header"></header><nav aria-label="開いているタブ"></nav><main id="app-main"></main>');
    render(<SkipLinks />);
    fireEvent.click(screen.getByTestId("skip-link-main"));
    expect(document.activeElement?.id).toBe("app-main");
    expect(document.getElementById("app-main")?.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(screen.getByTestId("skip-link-tabs"));
    expect(document.activeElement?.tagName).toBe("NAV");
  });
  it("領域が無ければ、何も起きない (false)", () => {
    expect(focusRegion("#none")).toBe(false);
  });
});
