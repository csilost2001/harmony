import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServerChangeBanner } from "./ServerChangeBanner";

describe("ServerChangeBanner (別のクライアントでデータが変更された)", () => {
  it("警告として読み上げられ (role=alert)、「再読み込み」「無視」を選べる。編集中の内容は、選ぶまで変えない", () => {
    const onReload = vi.fn(), onDismiss = vi.fn();
    render(<ServerChangeBanner onReload={onReload} onDismiss={onDismiss} />);
    expect(screen.getByRole("alert").textContent).toContain("別のクライアントでデータが変更されました");
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("再読み込み"));
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("無視"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
