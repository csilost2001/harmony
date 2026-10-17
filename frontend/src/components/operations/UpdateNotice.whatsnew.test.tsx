import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const version = vi.fn();
vi.mock("../../utils/opsApi", () => ({ opsApi: { version: () => version() } }));
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { startWithoutEditor: () => undefined, getStatus: () => "connected", onStatusChange: () => () => undefined } }));
vi.mock("../../utils/toast", () => ({ showToast: () => undefined }));
vi.mock("../../hooks/useFocusTrap", () => ({ useFocusTrap: () => undefined }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}`, wsId: "x" }) }));
import { UpdateNotice } from "./UpdateNotice";
import { markNoteSeen, markVersionSeen, readSeenNote } from "../../utils/updateNotice";

const n = (d: string, t: string) => ({ date: d, title: t });
const notes = [n("2026-10-17", "第 9 弾"), n("2026-10-16", "第 8 弾"), n("2026-10-15", "第 7 弾")];
const renderIt = () => render(<MemoryRouter><UpdateNotice /></MemoryRouter>);

beforeEach(() => { version.mockReset(); localStorage.clear(); });

describe("新しくなったこと (続編 第 10 弾 #190)", () => {
  it("更新のあと、前に見たリリースノートより新しいものを出す。閉じて、覚える", async () => {
    markVersionSeen({ version: "1.0.0", commit: "old" });
    markNoteSeen(notes[2]);
    version.mockResolvedValue({ version: "1.0.0", commit: "new", notes, notesTotal: 30 });
    renderIt();
    const list = await screen.findByTestId("whats-new-list");
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("第 9 弾"), expect.stringContaining("第 8 弾")]));
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText(/全 30 件/)).toBeTruthy();
    expect(readSeenNote()).toBe("2026-10-17|第 9 弾");
    fireEvent.click(screen.getByTestId("whats-new-close"));
    expect(screen.queryByTestId("whats-new")).toBeNull();
  });
  it("初回 (前に見た版が無い) と、新しいものが無いときは、出さない", async () => {
    version.mockResolvedValue({ version: "1.0.0", commit: "a", notes, notesTotal: 3 });
    const { unmount } = renderIt();
    await waitFor(() => expect(version).toHaveBeenCalled());
    expect(screen.queryByTestId("whats-new")).toBeNull();
    unmount();
    markVersionSeen({ version: "1.0.0", commit: "old" });
    markNoteSeen(notes[0]);
    renderIt();
    await waitFor(() => expect(version).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("whats-new")).toBeNull();
  });
});
