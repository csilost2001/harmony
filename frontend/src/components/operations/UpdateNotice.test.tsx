import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const version = vi.fn();
let status = "connected";
let onStatus: ((s: string) => void) | null = null;
vi.mock("../../utils/opsApi", () => ({ opsApi: { version: () => version() } }));
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { startWithoutEditor: () => undefined, getStatus: () => status, onStatusChange: (cb: (s: string) => void) => { onStatus = cb; return () => undefined; } } }));
const toast = vi.fn();
vi.mock("../../utils/toast", () => ({ showToast: (...a: unknown[]) => toast(...a) }));
import { UpdateNotice } from "./UpdateNotice";
import { markVersionSeen, readSeenVersion, versionChanged } from "../../utils/updateNotice";

beforeEach(() => { version.mockReset(); toast.mockReset(); localStorage.clear(); status = "connected"; onStatus = null; });

describe("更新の案内", () => {
  it("初回 (前に見た版がない) は知らせず、いまの版を覚える", async () => {
    version.mockResolvedValue({ version: "1.0.0", commit: "abc" });
    render(<UpdateNotice />);
    await waitFor(() => expect(readSeenVersion()).toBe("1.0.0+abc"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("前に見た版と違えば、版を添えて知らせ、覚え直す。同じ版なら知らせない", async () => {
    markVersionSeen({ version: "1.0.0", commit: "old" });
    version.mockResolvedValue({ version: "1.0.0", commit: "new" });
    render(<UpdateNotice />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toContain("Harmony が更新されました (版 1.0.0・new)");
    expect(toast.mock.calls[0][1]).toBe("info");
    expect(readSeenVersion()).toBe("1.0.0+new");
    toast.mockReset();
    render(<UpdateNotice />);
    await waitFor(() => expect(version).toHaveBeenCalledTimes(2));
    expect(toast).not.toHaveBeenCalled();
  });

  it("接続できていなければ、つながったときに調べる。版が読めなくても、画面は止めない", async () => {
    status = "connecting";
    version.mockRejectedValueOnce(new Error("x")).mockResolvedValue({ version: "2.0.0" });
    render(<UpdateNotice />);
    expect(version).not.toHaveBeenCalled();
    onStatus?.("connected");
    await waitFor(() => expect(version).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalled();
    onStatus?.("connected");
    await waitFor(() => expect(readSeenVersion()).toBe("2.0.0+"));
  });

  it("versionChanged: 前回が無ければ違わない", () => {
    expect(versionChanged({ version: "1.0.0" }, null)).toBe(false);
    expect(versionChanged({ version: "1.0.0" }, "1.0.0+")).toBe(false);
    expect(versionChanged({ version: "1.0.1" }, "1.0.0+")).toBe(true);
  });
});
