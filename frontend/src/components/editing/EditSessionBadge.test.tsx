/**
 * EditSessionBadge.test.tsx (#902 Phase 5)
 *
 * EditSessionBadge の RTL テスト。
 * spec docs/spec/edit-session-protocol.md §14.1 に準拠。
 * editSession.list ベースの badge 表示 / broadcast 連動を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { EditSessionBadge } from "./EditSessionBadge";
import type { EditSessionData } from "../../hooks/useEditSession";

// ── broadcast ハンドラー管理 ─────────────────────────────────────────────────

const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();
let requestMock = vi.fn();

vi.mock("../../mcp/mcpBridge", () => {
  const bridge = {
    request: (...args: unknown[]) => requestMock(...args),
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

function makeSession(overrides: Partial<EditSessionData> = {}): EditSessionData {
  return {
    id: "es-001",
    resourceType: "process-flow",
    resourceId: "pf-001",
    state: "Active",
    participants: {
      "sess-alice": {
        sessionId: "sess-alice",
        role: "Edit",
        joinedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        displayLabel: "@alice",
      },
    },
    payload: null,
    sequence: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    saveHistory: [],
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  requestMock = vi.fn();
  vi.clearAllMocks();
  broadcastHandlers.clear();
});

afterEach(() => {
  broadcastHandlers.clear();
});

describe("EditSessionBadge", () => {
  it("active EditSession が 0 件の場合は何も描画しない", async () => {
    requestMock.mockResolvedValue({ sessions: [] });
    const { container } = render(
      <EditSessionBadge resourceType="process-flow" resourceId="pf-001" />,
    );
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it("active EditSession が 1 件の場合 📝 1 バッジが表示される", async () => {
    requestMock.mockResolvedValue({ sessions: [makeSession()] });
    render(<EditSessionBadge resourceType="process-flow" resourceId="pf-001" />);
    await waitFor(() => {
      const badge = screen.getByTestId("edit-session-badge");
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain("📝");
      expect(badge.textContent).toContain("1");
    });
  });

  it("active EditSession が 2 件の場合 📝 2 バッジが表示される", async () => {
    requestMock.mockResolvedValue({
      sessions: [
        makeSession({ id: "es-001" }),
        makeSession({ id: "es-002" }),
      ],
    });
    render(<EditSessionBadge resourceType="process-flow" resourceId="pf-001" />);
    await waitFor(() => {
      const badge = screen.getByTestId("edit-session-badge");
      expect(badge.textContent).toContain("2");
    });
  });

  it("Discarded 状態の EditSession はバッジに含まない", async () => {
    requestMock.mockResolvedValue({
      sessions: [makeSession({ state: "Discarded" })],
    });
    const { container } = render(
      <EditSessionBadge resourceType="process-flow" resourceId="pf-001" />,
    );
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it("tooltip に editor の displayLabel が含まれる", async () => {
    requestMock.mockResolvedValue({ sessions: [makeSession()] });
    render(<EditSessionBadge resourceType="process-flow" resourceId="pf-001" />);
    await waitFor(() => {
      const badge = screen.getByTestId("edit-session-badge");
      expect(badge.getAttribute("title")).toContain("@alice");
    });
  });

  it("editSession.created broadcast 後に再 fetch する", async () => {
    // 最初は 0 件、broadcast 後に 1 件
    requestMock
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce({ sessions: [makeSession()] });

    render(<EditSessionBadge resourceType="process-flow" resourceId="pf-001" />);

    // 初回 fetch 完了待ち
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    // broadcast を発火
    await act(async () => {
      fireBroadcast("editSession.created", { resourceType: "process-flow", resourceId: "pf-001" });
    });

    await waitFor(() => {
      const badge = screen.getByTestId("edit-session-badge");
      expect(badge.textContent).toContain("1");
    });
  });

  it("editSession.discarded broadcast 後に再 fetch する", async () => {
    // 最初は 1 件、broadcast 後は 0 件
    requestMock
      .mockResolvedValueOnce({ sessions: [makeSession()] })
      .mockResolvedValueOnce({ sessions: [] });

    render(<EditSessionBadge resourceType="process-flow" resourceId="pf-001" />);

    // 初回 fetch 完了待ち
    await waitFor(() => {
      expect(screen.getByTestId("edit-session-badge")).toBeTruthy();
    });

    // broadcast を発火
    await act(async () => {
      fireBroadcast("editSession.discarded", { editSessionId: "es-001" });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("edit-session-badge")).toBeNull();
    });
  });
});
