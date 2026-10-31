import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaleBuildBanner } from "./StaleBuildBanner";

afterEach(() => vi.unstubAllGlobals());

describe("StaleBuildBanner (#1572)", () => {
  it("更新の知らせと再読み込みボタンを出し、押すと再読み込みする", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<StaleBuildBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("Harmony が更新されました。再読み込みしてください");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
