import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { RegionNavigator } from "./RegionNavigator";

describe("RegionNavigator", () => {
  it("F6 で次の領域、Shift+F6 で前の領域へ移る", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <>
        <RegionNavigator />
        <header className="common-header"><button id="hb">h</button></header>
        <nav className="tabbar"><a href="#x" id="tb">t</a></nav>
        <main id="app-main"><section data-region="一覧"><input id="i1" /></section></main>
      </>,
    );
    expect(container).toBeTruthy();
    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("hb");
    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("tb");
    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("i1");
    fireEvent.keyDown(document, { key: "F6" });
    expect(document.activeElement?.id).toBe("hb"); // 巡回
    fireEvent.keyDown(document, { key: "F6", shiftKey: true });
    expect(document.activeElement?.id).toBe("i1");
  });
});
