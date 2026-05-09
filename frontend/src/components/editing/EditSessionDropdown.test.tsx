/**
 * EditSessionDropdown.test.tsx (#900 Phase 3)
 *
 * RTL で展開 / アクション dispatch / editSession.list 表示 / AI@表示 を検証する。
 *
 * 変更 (Phase 3):
 * - データソース: usePresenceFor (旧) → editSession.list (新)
 * - AI participant 表示: "@Alice@AI" 形式の確認
 * - 観察ボタン: attachAsView 呼び出し確認
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditSessionDropdown } from "./EditSessionDropdown";
import type { EditSessionData } from "../../hooks/useEditSession";

// ── モック ─────────────────────────────────────────────────────────────────

const mockRequest = vi.fn().mockResolvedValue({ sessions: [] });
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: (...args: unknown[]) => mockRequest(...args),
    onBroadcast: vi.fn(() => () => {}),
  },
}));

// CSS import は Vitest 環境で副作用なし
vi.mock("../../styles/editSessionDropdown.css", () => ({}));

// ── テストデータ ─────────────────────────────────────────────────────────────

// #980-A review 3: onAttachAsView / onTakeOver は required prop 化されたため
// defaultProps で no-op stub を渡す。テスト個別の振る舞い検証はそれぞれで上書き。
const defaultProps = {
  resourceType: "process-flow" as const,
  resourceId: "flow-001",
  currentMode: { kind: "readonly" } as const,
  currentSessionId: "session-self",
  onAttachAsView: async () => { /* no-op default */ },
  onTakeOver: async () => { /* no-op default */ },
};

function makeEditSession(overrides: Partial<EditSessionData> = {}): EditSessionData {
  return {
    id: "es-test-001",
    resourceType: "process-flow",
    resourceId: "flow-001",
    state: "Active",
    participants: {
      "session-alice": {
        sessionId: "session-alice",
        role: "Edit",
        joinedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        displayLabel: "@alice",
      },
    },
    payload: null,
    sequence: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    saveHistory: [],
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAIEditSession(): EditSessionData {
  return makeEditSession({
    id: "es-ai-001",
    participants: {
      "session-alice": {
        sessionId: "session-alice",
        role: "Edit",
        joinedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        displayLabel: "Alice@AI",
        parentHumanSessionId: "session-human-alice",
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // デフォルト: sessions が空
  mockRequest.mockResolvedValue({ sessions: [] });
});

// ── テスト ─────────────────────────────────────────────────────────────────

describe("EditSessionDropdown", () => {
  it("closed 状態では 📄 正規版 バッジが表示される", () => {
    render(<EditSessionDropdown {...defaultProps} />);
    expect(screen.getByTestId("esd-toggle-btn")).toBeTruthy();
    expect(screen.getByText("正規版")).toBeTruthy();
  });

  it("editing mode では ✏️ 編集中 バッジが表示される", () => {
    render(
      <EditSessionDropdown
        {...defaultProps}
        currentMode={{ kind: "editing" }}
      />,
    );
    expect(screen.getByText("編集中")).toBeTruthy();
  });

  it("viewer mode では 👁 観察中 バッジが表示される", () => {
    render(
      <EditSessionDropdown
        {...defaultProps}
        currentMode={{ kind: "viewer" }}
      />,
    );
    expect(screen.getByText("観察中")).toBeTruthy();
  });

  it("トグルボタンをクリックするとドロップダウンが展開される", async () => {
    render(<EditSessionDropdown {...defaultProps} />);
    const toggle = screen.getByTestId("esd-toggle-btn");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId("esd-dropdown")).toBeTruthy();
    });
  });

  it("展開後、ドロップダウン外をクリックすると閉じる", async () => {
    render(
      <div>
        <EditSessionDropdown {...defaultProps} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));
    await waitFor(() => screen.getByTestId("esd-dropdown"));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("esd-dropdown")).toBeNull();
  });

  it("+ 新規 draft を作成 ボタンが表示され、クリックで onStartEditing が呼ばれる", async () => {
    const onStartEditing = vi.fn();
    render(<EditSessionDropdown {...defaultProps} onStartEditing={onStartEditing} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));
    await waitFor(() => screen.getByTestId("esd-new-draft-btn"));
    fireEvent.click(screen.getByTestId("esd-new-draft-btn"));
    expect(onStartEditing).toHaveBeenCalledTimes(1);
  });

  // ── editSession.list ベースのテスト ─────────────────────────────────────────

  it("展開時に editSession.list が呼ばれる", async () => {
    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith("editSession.list", {
        resourceType: "process-flow",
        resourceId: "flow-001",
      });
    });
  });

  it("2 つの EditSession が両方表示される", async () => {
    mockRequest.mockResolvedValue({
      sessions: [
        makeEditSession({ id: "es-001" }),
        makeEditSession({ id: "es-002" }),
      ],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("esd-session-es-001")).toBeTruthy();
      expect(screen.getByTestId("esd-session-es-002")).toBeTruthy();
    });
  });

  it("未参加の EditSession には [👁 観察] ボタンが表示される", async () => {
    mockRequest.mockResolvedValue({
      sessions: [makeEditSession({ id: "es-001" })],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("esd-viewer-btn-es-001")).toBeTruthy();
    });
  });

  it("[👁 観察] クリックで onAttachAsView prop が呼ばれ onViewerAttached が発火する (#980-A: required prop 化)", async () => {
    mockRequest.mockResolvedValueOnce({ sessions: [makeEditSession({ id: "es-001" })] }); // list

    const onAttachAsView = vi.fn().mockResolvedValue(undefined);
    const onViewerAttached = vi.fn();
    render(
      <EditSessionDropdown
        {...defaultProps}
        onAttachAsView={onAttachAsView}
        onViewerAttached={onViewerAttached}
      />,
    );
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => screen.getByTestId("esd-viewer-btn-es-001"));
    fireEvent.click(screen.getByTestId("esd-viewer-btn-es-001"));

    await waitFor(() => {
      // #980-A review 3: 直接 mcpBridge.request を叩く fallback は削除済。
      // 代わりに parent useEditSession.attach 経由 (= onAttachAsView prop) で role 同期する。
      expect(onAttachAsView).toHaveBeenCalledWith("es-001");
      expect(onViewerAttached).toHaveBeenCalledWith("es-001");
    });
  });

  it("AI participant の 'Alice@AI' 表示が確認される", async () => {
    mockRequest.mockResolvedValue({
      sessions: [makeAIEditSession()],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    // AI session row が表示されることを確認 (testid 経由 — text matcher は flaky な場合あり)
    await waitFor(() => screen.getByTestId("esd-session-es-ai-001"), { timeout: 3000 });
    // displayLabel に "Alice@AI" を含む要素が存在することを確認
    await waitFor(() => {
      const labelEl = screen.getByText((content) => content.includes("Alice@AI"));
      expect(labelEl).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("Discarded EditSession には観察ボタンが表示されない", async () => {
    mockRequest.mockResolvedValue({
      sessions: [makeEditSession({ id: "es-discarded", state: "Discarded" })],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => screen.getByTestId("esd-session-es-discarded"));
    expect(screen.queryByTestId("esd-viewer-btn-es-discarded")).toBeNull();
  });

  // ── Phase 7 (#904) 追加ケース: AI 表示 / take-over / discard ────────────────

  it("Phase7: AI participant を含む EditSession では 'AI' ラベルが表示される (spec §10.3)", async () => {
    mockRequest.mockResolvedValue({
      sessions: [makeAIEditSession()],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      // "Alice@AI" という displayLabel が表示されること (spec §10.3 Alice@AI 形式)
      expect(screen.getByText("Alice@AI")).toBeTruthy();
    });
  });

  it("Phase7: 自分が View の場合 [↪ 引継] ボタンが表示される (spec §7.2 View 経由必須)", async () => {
    // session-self が View participant として参加している
    mockRequest.mockResolvedValue({
      sessions: [
        makeEditSession({
          id: "es-takeover-test",
          participants: {
            "session-alice": {
              sessionId: "session-alice",
              role: "Edit",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@alice",
            },
            "session-self": {
              sessionId: "session-self",
              role: "View",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@self",
            },
          },
        }),
      ],
    });

    render(<EditSessionDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      // View として参加中 → take-over ボタンが表示される
      expect(screen.getByTestId("esd-takeover-btn-es-takeover-test")).toBeTruthy();
    });
  });

  it("Phase7: 自分が Edit の場合 [× 破棄] ボタンが表示される", async () => {
    // session-self が Edit participant として参加している
    mockRequest.mockResolvedValue({
      sessions: [
        makeEditSession({
          id: "es-discard-test",
          participants: {
            "session-self": {
              sessionId: "session-self",
              role: "Edit",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@self",
            },
          },
        }),
      ],
    });

    render(<EditSessionDropdown {...defaultProps} currentMode={{ kind: "editing" }} />);
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => {
      // Edit として参加中 → discard ボタンが表示される
      expect(screen.getByTestId("esd-discard-btn-es-discard-test")).toBeTruthy();
    });
  });

  // ── P2 fix (#908): take-over で onTakeOver が呼ばれる ───────────────────────

  it("#908 P2: [↪ 引継] クリックで onTakeOver callback が呼ばれ myRole が即時更新できる", async () => {
    // session-self が View participant として参加している
    mockRequest.mockResolvedValue({
      sessions: [
        makeEditSession({
          id: "es-takeover-p2",
          participants: {
            "session-alice": {
              sessionId: "session-alice",
              role: "Edit",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@alice",
            },
            "session-self": {
              sessionId: "session-self",
              role: "View",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@self",
            },
          },
        }),
      ],
    });

    const onTakeOver = vi.fn().mockResolvedValue(undefined);
    // window.confirm を自動承認
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <EditSessionDropdown
        {...defaultProps}
        onTakeOver={onTakeOver}
      />,
    );
    fireEvent.click(screen.getByTestId("esd-toggle-btn"));

    await waitFor(() => screen.getByTestId("esd-takeover-btn-es-takeover-p2"));
    fireEvent.click(screen.getByTestId("esd-takeover-btn-es-takeover-p2"));

    await waitFor(() => {
      // onTakeOver が選択した editSessionId を引数として呼ばれること (P2 fix #908)
      expect(onTakeOver).toHaveBeenCalledTimes(1);
      expect(onTakeOver).toHaveBeenCalledWith("es-takeover-p2");
      // editSession.transferEdit を直接呼んでいないこと
      expect(mockRequest).not.toHaveBeenCalledWith("editSession.transferEdit", expect.anything());
    });

    vi.restoreAllMocks();
  });

  // #980-A review 3: onTakeOver は required prop 化されたため、fallback (mcpBridge 直叩き) は
  // 削除済。旧テスト「onTakeOver 未指定の fallback で transferEdit を直接呼ぶ」は新仕様では
  // TS compile error で検出されるためテスト自体が不要になった (削除)。
});
