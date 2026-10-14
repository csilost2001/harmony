import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DisplaySettings } from "./DisplaySettings";
import { initDisplayPrefs, getDisplayPrefs } from "../../theme/displayPrefs";
import { requestHeaderPanel } from "../../utils/headerPanels";

describe("DisplaySettings (表示の設定)", () => {
  beforeEach(() => { localStorage.clear(); for (const a of ["data-font-scale", "data-density", "data-contrast"]) document.documentElement.removeAttribute(a); initDisplayPrefs(); });

  it("文字サイズ・密度・コントラストを選ぶと、<html> に反映され、変えたことが印に出る。標準に戻せる", () => {
    render(<DisplaySettings />);
    fireEvent.click(screen.getByTestId("display-settings-open"));
    fireEvent.click(screen.getByTestId("disp-fontScale-large"));
    fireEvent.click(screen.getByTestId("disp-density-compact"));
    fireEvent.click(screen.getByTestId("disp-contrast-high"));
    expect(getDisplayPrefs()).toEqual({ fontScale: "large", density: "compact", contrast: "high" });
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("large");
    expect(document.querySelector(".disp-dot")).not.toBeNull();
    fireEvent.click(screen.getByTestId("display-settings-reset"));
    expect(getDisplayPrefs()).toEqual({ fontScale: "standard", density: "standard", contrast: "standard" });
    expect(document.documentElement.hasAttribute("data-font-scale")).toBe(false);
  });

  it("コマンドから開け、Esc で閉じる", () => {
    render(<DisplaySettings />);
    act(() => requestHeaderPanel("display"));
    expect(screen.getByTestId("display-settings")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("display-settings-open"), { key: "Escape" });
    expect(screen.queryByTestId("display-settings")).toBeNull();
  });
});
