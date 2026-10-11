import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChangesHost } from "./ChangesHost";
import { registerChangeSource, requestShowChanges } from "../../utils/changeSource";
import { _resetForTests, setActiveTab } from "../../store/tabStore";

describe("ChangesHost", () => {
  afterEach(() => _resetForTests());

  it("合図を受けると、いまのタブの文書の差を出す", () => {
    const before = { name: "a", columns: [{ id: "c1", name: "x" }] };
    const after = { name: "b", columns: [{ id: "c1", name: "x" }, { id: "c2", name: "y" }] };
    const off = registerChangeSource("table:t1", { getBefore: () => before, getAfter: () => after });
    setActiveTab("table:t1");
    render(<ChangesHost />);
    expect(screen.queryByTestId("changes-dialog")).toBeNull();
    act(() => requestShowChanges());
    expect(screen.getByTestId("changes-summary").textContent).toBe("追加 1 / 変更 1");
    off();
  });

  it("文書が登録されていなければ何も出さない", () => {
    render(<ChangesHost />);
    act(() => requestShowChanges());
    expect(screen.queryByTestId("changes-dialog")).toBeNull();
  });
});
