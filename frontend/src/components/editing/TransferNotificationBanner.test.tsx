/**
 * TransferNotificationBanner.test.tsx (#902 Phase 5)
 *
 * TransferNotificationBanner の RTL テスト。
 * spec docs/spec/edit-session-protocol.md §14.1 に準拠。
 * editSession.roleChanged (新 API) + lock.changed (後方互換) の両方を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TransferNotificationBanner } from "./TransferNotificationBanner";

// ── broadcast ハンドラー管理 ─────────────────────────────────────────────────

const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();

vi.mock("../../mcp/mcpBridge", () => {
  const bridge = {
    request: vi.fn().mockResolvedValue({}),
    onBroadcast: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!broadcastHandlers.has(event)) {
        broadcastHandlers.set(event, new Set());
      }
      broadcastHandlers.get(event)!.add(handler);
      return () => broadcastHandlers.get(event)?.delete(handler);
    }),
  };
  return { mcpBridge: bridge };
});

function fireBroadcast(event: string, data: unknown) {
  broadcastHandlers.get(event)?.forEach((h) => h(data));
}

const CLIENT_ID = "client-alice-0000000000";

beforeEach(() => {
  vi.clearAllMocks();
  broadcastHandlers.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  broadcastHandlers.clear();
  vi.useRealTimers();
});

describe("TransferNotificationBanner — 新 API (editSession.roleChanged)", () => {
  it("初期状態では何も表示しない", () => {
    const { container } = render(
      <TransferNotificationBanner clientId={CLIENT_ID} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("editSession.roleChanged op=transferred: fromSessionId = self → 「@xxx が編集を引き継ぎました」", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-001",
        sessionId: "bob-session-0000000",
        oldRole: "Edit",
        newRole: "View",
        op: "transferred",
        fromSessionId: CLIENT_ID,
        toSessionId: "bob-session-0000000",
        toLabel: "bob",
      });
    });

    const banner = screen.getByTestId("transfer-notification-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("が編集を引き継ぎました");
    expect(banner.textContent).toContain("bob");
  });

  it("editSession.roleChanged op=transferred: toSessionId = self → 「@xxx から編集を引き継ぎました」", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-001",
        sessionId: CLIENT_ID,
        oldRole: "View",
        newRole: "Edit",
        op: "transferred",
        fromSessionId: "alice-prev-session",
        toSessionId: CLIENT_ID,
        fromLabel: "alice",
      });
    });

    const banner = screen.getByTestId("transfer-notification-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("から編集を引き継ぎました");
    expect(banner.textContent).toContain("alice");
  });

  it("editSession.roleChanged: op が transferred でない場合は無視", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-001",
        sessionId: CLIENT_ID,
        oldRole: "Edit",
        newRole: "View",
        op: "manual",
        fromSessionId: "other-session",
        toSessionId: CLIENT_ID,
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("editSession.roleChanged: 自分と無関係な transferred は表示しない", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-001",
        sessionId: "charlie-session",
        oldRole: "Edit",
        newRole: "View",
        op: "transferred",
        fromSessionId: "bob-session",
        toSessionId: "charlie-session",
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("5 秒後に autoclose される (editSession.roleChanged)", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-001",
        sessionId: "bob-session",
        oldRole: "Edit",
        newRole: "View",
        op: "transferred",
        fromSessionId: CLIENT_ID,
        toSessionId: "bob-session",
      });
    });

    expect(screen.getByTestId("transfer-notification-banner")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });
});

describe("TransferNotificationBanner — 後方互換 (lock.changed)", () => {
  it("previousOwner = self の broadcast → 「引き継がれました」バナーが表示される", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-001",
        op: "transferred",
        ownerSessionId: "bob-session-id-0000000",
        by: "bob-session-id-0000000",
        previousOwner: CLIENT_ID,
      });
    });

    const banner = screen.getByTestId("transfer-notification-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("に引き継がれました");
    expect(banner.textContent).toContain("bob-sess");
  });

  it("newOwner = self の broadcast → 「draft を引継ぎました」バナーが表示される", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-001",
        op: "transferred",
        ownerSessionId: CLIENT_ID,
        by: CLIENT_ID,
        previousOwner: "alice-prev-session-0000",
      });
    });

    const banner = screen.getByTestId("transfer-notification-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("draft を引継ぎました");
    expect(banner.textContent).toContain("alice-pr");
  });

  it("5 秒後に autoclose される", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-001",
        op: "transferred",
        ownerSessionId: "bob-session",
        by: "bob-session",
        previousOwner: CLIENT_ID,
      });
    });

    expect(screen.getByTestId("transfer-notification-banner")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("transferred 以外の op は無視される", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-001",
        op: "acquired",
        ownerSessionId: "bob-session",
        by: "bob-session",
        previousOwner: CLIENT_ID,
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("自分とも無関係な transferred は表示しない", () => {
    render(<TransferNotificationBanner clientId={CLIENT_ID} />);

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-001",
        op: "transferred",
        ownerSessionId: "charlie-session",
        by: "charlie-session",
        previousOwner: "bob-session",
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("resourceType フィルタ: 一致しない場合は無視される", () => {
    render(
      <TransferNotificationBanner
        clientId={CLIENT_ID}
        resourceType="process-flow"
        resourceId="pf-001"
      />,
    );

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "pf-001",
        op: "transferred",
        ownerSessionId: "bob-session",
        by: "bob-session",
        previousOwner: CLIENT_ID,
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });

  it("resourceId フィルタ: 一致しない場合は無視される", () => {
    render(
      <TransferNotificationBanner
        clientId={CLIENT_ID}
        resourceType="process-flow"
        resourceId="pf-001"
      />,
    );

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "process-flow",
        resourceId: "pf-OTHER",
        op: "transferred",
        ownerSessionId: "bob-session",
        by: "bob-session",
        previousOwner: CLIENT_ID,
      });
    });

    expect(screen.queryByTestId("transfer-notification-banner")).toBeNull();
  });
});
