/**
 * useEditSession.test.ts (#900 Phase 3, Phase 6 cleanup)
 *
 * テスト構成:
 * - describe "useEditSession (新 API)" — spec §15.2 準拠の 8+ ケース
 * Phase 6 (#903): useEditSessionLegacy テスト削除済み (旧 API 完全削除)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditSession } from "./useEditSession";

const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();

vi.mock("../mcp/mcpBridge", () => {
  const bridge = {
    request: vi.fn(),
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

import { mcpBridge } from "../mcp/mcpBridge";

const SESSION_ID = "session-abc";

const NEW_OPTS = {
  resourceType: "table" as const,
  resourceId: "tbl-001",
};

const MOCK_EDIT_SESSION = {
  id: "es-test-001",
  resourceType: "table" as const,
  resourceId: "tbl-001",
  state: "Active" as const,
  participants: {
    "session-abc": {
      sessionId: "session-abc",
      role: "Edit" as const,
      joinedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      displayLabel: "@alice",
    },
  },
  payload: { data: "initial" },
  sequence: 1,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  saveHistory: [],
  lastActivityAt: new Date().toISOString(),
};

const MOCK_EDIT_SESSION_WITH_VIEW = {
  ...MOCK_EDIT_SESSION,
  participants: {
    "session-abc": {
      sessionId: "session-abc",
      role: "View" as const,
      joinedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      displayLabel: "@alice",
    },
    "session-editor": {
      sessionId: "session-editor",
      role: "Edit" as const,
      joinedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      displayLabel: "@bob",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  broadcastHandlers.clear();
  (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

afterEach(() => {
  broadcastHandlers.clear();
});

// ══════════════════════════════════════════════════════════════════════════════
// 新 API テスト (spec §15.2)
// ══════════════════════════════════════════════════════════════════════════════

describe("useEditSession (新 API, spec §15.2)", () => {
  // ── ケース 1: startEditing → editSession.create 呼び出し、myRole === "Edit" ──

  it("1. startEditing: editSession.create を呼び myRole が Edit になる", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));
    expect(result.current.myRole).toBeNull();

    await act(async () => {
      await result.current.startEditing();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.create", {
      resourceType: "table",
      resourceId: "tbl-001",
    });
    expect(result.current.myRole).toBe("Edit");
    expect(result.current.editSession?.id).toBe("es-test-001");
  });

  // ── ケース 2: attach(editSessionId) → attachAsView + fetchPayload (§13.3) ──

  it("2. attach: attachAsView を呼び initial payload を即座に取得する (§13.3 根本欠陥の解消)", async () => {
    // attachAsView response に payload + sequence が含まれる (backend が fetchCurrentPayload を自動実行)
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      participant: { sessionId: SESSION_ID, role: "View" },
      payload: { data: "latest-state" },
      sequence: 5,
    });
    // refreshEditSessionState (editSession.list) mock
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [MOCK_EDIT_SESSION_WITH_VIEW],
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.attach("es-test-001");
    });

    // editSession.attachAsView が呼ばれたことを確認
    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.attachAsView", {
      editSessionId: "es-test-001",
    });

    // initial payload が即座に反映されること (= §13.3 根本欠陥の解消)
    expect(result.current.payload).toEqual({ data: "latest-state" });
    expect(result.current.myRole).toBe("View");
  });

  // ── ケース 3: takeOver → editSession.transferEdit 呼び出し、myRole が View → Edit ──

  it("3. takeOver: transferEdit を呼び myRole が Edit になる", async () => {
    // 先に attach して View 状態を作る
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      participant: { sessionId: SESSION_ID, role: "View" },
      payload: null,
      sequence: 0,
    });
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [{ ...MOCK_EDIT_SESSION, id: "es-test-001", participants: { [SESSION_ID]: { role: "View", sessionId: SESSION_ID, displayLabel: "@alice", joinedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() } } }],
    });
    // takeOver の transferEdit mock
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      from: { sessionId: "session-editor", role: "View" },
      to: { sessionId: SESSION_ID, role: "Edit" },
    });
    // refreshEditSessionState
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [MOCK_EDIT_SESSION],
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.attach("es-test-001");
    });

    expect(result.current.myRole).toBe("View");

    await act(async () => {
      await result.current.takeOver();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.transferEdit", expect.objectContaining({
      editSessionId: "es-test-001",
    }));
    expect(result.current.myRole).toBe("Edit");
  });

  // ── ケース 4: releaseEdit → setRole("View") 呼び出し、myRole が Edit → View ──

  it("4. releaseEdit: editSession.setRole(View) を呼び myRole が View になる", async () => {
    // startEditing で Edit 状態を作る
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    expect(result.current.myRole).toBe("Edit");

    // setRole mock
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      participant: { sessionId: SESSION_ID, role: "View" },
    });

    await act(async () => {
      await result.current.releaseEdit();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.setRole", {
      editSessionId: "es-test-001",
      role: "View",
    });
    expect(result.current.myRole).toBe("View");
  });

  // ── ケース 5: save → editSession.save 呼び出し ──

  it("5. save: editSession.save を呼ぶ", async () => {
    // startEditing
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // save mock
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      saveEvent: { savedBy: SESSION_ID, savedAt: new Date().toISOString(), sequence: 1 },
    });
    // refreshEditSessionState for saved broadcast
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [MOCK_EDIT_SESSION] });

    await act(async () => {
      await result.current.save();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.save", {
      editSessionId: "es-test-001",
    });
  });

  // ── ケース 6: discard → editSession.discard 呼び出し、state === "Discarded" ──

  it("6. discard: editSession.discard を呼び editSession.state が Discarded になる", async () => {
    // startEditing
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // discard mock
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      discarded: true,
    });

    await act(async () => {
      await result.current.discard();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.discard", {
      editSessionId: "es-test-001",
    });
    expect(result.current.editSession?.state).toBe("Discarded");
    expect(result.current.myRole).toBeNull();
  });

  // ── ケース 7: broadcast editSession.update — 古い sequence は無視 ──

  it("7. broadcast editSession.update: 古い sequence は無視し、新しい sequence で payload 更新", async () => {
    // startEditing
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // sequence=1 からスタート (MOCK_EDIT_SESSION.sequence = 1)
    // sequence=2 の broadcast: 受け入れる
    await act(async () => {
      fireBroadcast("editSession.update", {
        editSessionId: "es-test-001",
        sequence: 2,
        payload: { data: "update-v2" },
        senderSessionId: "other-session",
      });
    });

    expect(result.current.payload).toEqual({ data: "update-v2" });

    // sequence=1 の broadcast (古い): 無視する
    await act(async () => {
      fireBroadcast("editSession.update", {
        editSessionId: "es-test-001",
        sequence: 1,
        payload: { data: "old-data" },
        senderSessionId: "other-session",
      });
    });

    // payload は更新されない (古い sequence は無視)
    expect(result.current.payload).toEqual({ data: "update-v2" });
  });

  // ── ケース 8: broadcast editSession.roleChanged → myRole が反映 ──

  it("8. broadcast editSession.roleChanged: refreshEditSessionState が呼ばれる", async () => {
    // startEditing
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // roleChanged broadcast を受信 (editSession.list で state を refresh)
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [MOCK_EDIT_SESSION_WITH_VIEW],
    });

    await act(async () => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-test-001",
        sessionId: SESSION_ID,
        oldRole: "Edit",
        newRole: "View",
      });
    });

    // refreshEditSessionState が呼ばれたことを確認 (editSession.list)
    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.list", {
      resourceType: "table",
      resourceId: "tbl-001",
    });
  });

  // ── ケース: editSession.update の editSessionId フィルタ ──

  it("異なる editSessionId の broadcast は無視される", async () => {
    // startEditing
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    const initialPayload = result.current.payload;

    // 別 editSessionId の broadcast: 無視される
    await act(async () => {
      fireBroadcast("editSession.update", {
        editSessionId: "es-other-session",
        sequence: 100,
        payload: { data: "should-be-ignored" },
        senderSessionId: "other-session",
      });
    });

    // payload は変わらない
    expect(result.current.payload).toEqual(initialPayload);
  });

  // ── ケース: editSession.discarded broadcast → state が Discarded ──

  it("broadcast editSession.discarded: editSession.state が Discarded になる", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    expect(result.current.editSession?.state).toBe("Active");

    await act(async () => {
      fireBroadcast("editSession.discarded", {
        editSessionId: "es-test-001",
        reason: "manual",
      });
    });

    expect(result.current.editSession?.state).toBe("Discarded");
  });

  // ── ケース: editSession.expired broadcast → editSession が null になる ──

  it("broadcast editSession.expired: editSession が null になる", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    expect(result.current.editSession).not.toBeNull();

    await act(async () => {
      fireBroadcast("editSession.expired", {
        editSessionId: "es-test-001",
      });
    });

    expect(result.current.editSession).toBeNull();
    expect(result.current.myRole).toBeNull();
    expect(result.current.payload).toBeNull();
  });

  // ── ケース: initialEditSessionId が指定された場合は自動 attach ──

  it("initialEditSessionId が指定された場合、自動 attach が実行される", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      participant: { sessionId: SESSION_ID, role: "View" },
      payload: { data: "auto-attached" },
      sequence: 3,
    });
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [MOCK_EDIT_SESSION_WITH_VIEW],
    });

    const { result } = renderHook(() =>
      useEditSession({ ...NEW_OPTS, editSessionId: "es-test-001" }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.attachAsView", {
      editSessionId: "es-test-001",
    });
    // initial payload が取得されること
    expect(result.current.payload).toEqual({ data: "auto-attached" });
  });
});
// Phase 6 (#903): useEditSessionLegacy テスト削除済み。

// ══════════════════════════════════════════════════════════════════════════════
// Phase 7 (#904) 追加ケース — broadcast 受信時の myRole 反映 / payload 反映の網羅
// ══════════════════════════════════════════════════════════════════════════════

describe("useEditSession Phase 7 追加: broadcast 反映の網羅 (spec §14 / §18.1)", () => {
  // ── ケース P7-1: editSession.roleChanged で myRole が View に変わる ──

  it("P7-1. broadcast editSession.roleChanged (newRole=View): myRole が View に反映される", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // Edit 状態
    expect(result.current.myRole).toBe("Edit");

    // roleChanged broadcast で View に降格 (take-over された側)
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [
        {
          ...MOCK_EDIT_SESSION,
          participants: {
            [SESSION_ID]: {
              sessionId: SESSION_ID,
              role: "View",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@alice",
            },
            "session-editor": {
              sessionId: "session-editor",
              role: "Edit",
              joinedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              displayLabel: "@bob",
            },
          },
        },
      ],
    });

    await act(async () => {
      fireBroadcast("editSession.roleChanged", {
        editSessionId: "es-test-001",
        sessionId: SESSION_ID,
        oldRole: "Edit",
        newRole: "View",
        op: "transferred",
        transferTo: "session-editor",
      });
    });

    // refreshEditSessionState が呼ばれたことを確認
    expect(mcpBridge.request).toHaveBeenCalledWith("editSession.list", {
      resourceType: "table",
      resourceId: "tbl-001",
    });
  });

  // ── ケース P7-2: payload の broadcast 反映と editSession フィルタ ──

  it("P7-2. broadcast editSession.update: payload が正しく反映される (sequence フィルタ)", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // 自分の editSession の更新は反映される
    await act(async () => {
      fireBroadcast("editSession.update", {
        editSessionId: "es-test-001",
        sequence: 5,
        payload: { data: "p7-payload" },
        senderSessionId: "other-session",
      });
    });

    expect(result.current.payload).toEqual({ data: "p7-payload" });

    // sequence が古い場合は無視
    await act(async () => {
      fireBroadcast("editSession.update", {
        editSessionId: "es-test-001",
        sequence: 3, // 古い sequence
        payload: { data: "stale-payload" },
        senderSessionId: "other-session",
      });
    });

    // stale payload は反映されない
    expect(result.current.payload).toEqual({ data: "p7-payload" });
  });

  // ── ケース P7-3: editSession.saved broadcast 後の state 確認 ──

  it("P7-3. broadcast editSession.saved: save 後も state は Active のまま (§4.1 Active 継続)", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      editSession: MOCK_EDIT_SESSION,
    });

    const { result } = renderHook(() => useEditSession(NEW_OPTS));

    await act(async () => {
      await result.current.startEditing();
    });

    // editSession.saved broadcast を受信しても Discarded にはならない
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [MOCK_EDIT_SESSION],
    });

    await act(async () => {
      fireBroadcast("editSession.saved", {
        editSessionId: "es-test-001",
        savedBy: SESSION_ID,
        savedAt: new Date().toISOString(),
        sequence: 1,
      });
    });

    // state は Active のまま
    expect(result.current.editSession?.state).toBe("Active");
    expect(result.current.myRole).toBe("Edit");
  });
});
