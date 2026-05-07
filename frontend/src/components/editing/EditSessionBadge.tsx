/**
 * EditSessionBadge.tsx (#902 Phase 5)
 *
 * リソース一覧画面で EditSession (新 API) を集約表示するバッジ。
 * spec docs/spec/edit-session-protocol.md §14.1 に準拠。
 *
 * - データソース: editSession.list (新 API)
 * - broadcast event listen:
 *   editSession.created / attached / detached / discarded で再 fetch
 * - 表示:
 *   active 0 件: badge 非表示
 *   active 1 件以上: 📝 N (= active EditSession 数)
 *   ホバー時: tooltip で各 EditSession の participants
 */
import { useCallback, useEffect, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { DraftResourceType } from "../../types/draft";
import type { EditSessionData } from "../../hooks/useEditSession";

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface EditSessionBadgeProps {
  resourceType: DraftResourceType;
  resourceId: string;
}

// ── ヘルパー ─────────────────────────────────────────────────────────────────

function buildTooltip(sessions: EditSessionData[]): string {
  if (sessions.length === 0) return "";
  const lines: string[] = [];
  for (const s of sessions) {
    const participants = Object.values(s.participants);
    const editor = participants.find((p) => p.role === "Edit");
    const viewers = participants.filter((p) => p.role === "View");
    const editorLabel = editor
      ? `編集中: ${editor.displayLabel || editor.sessionId.slice(0, 8)}`
      : "編集者なし";
    const viewerLabel =
      viewers.length > 0
        ? `閲覧中: ${viewers.map((v) => v.displayLabel || v.sessionId.slice(0, 8)).join(", ")}`
        : null;
    const parts = [editorLabel, viewerLabel].filter(Boolean).join(" / ");
    lines.push(`[${s.id.slice(0, 8)}] ${parts}`);
  }
  return lines.join("\n");
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export function EditSessionBadge({ resourceType, resourceId }: EditSessionBadgeProps) {
  const [activeSessions, setActiveSessions] = useState<EditSessionData[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const result = await mcpBridge.request("editSession.list", {
        resourceType,
        resourceId,
      }) as { sessions: EditSessionData[] };
      const active = (result.sessions ?? []).filter((s) => s.state === "Active");
      setActiveSessions(active);
    } catch (e) {
      console.warn("[EditSessionBadge] editSession.list failed:", e);
      setActiveSessions([]);
    }
  }, [resourceType, resourceId]);

  // mount 時に初回 fetch
  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  // broadcast event で再 fetch
  useEffect(() => {
    const refresh = () => { void fetchSessions(); };
    const unsubs = [
      mcpBridge.onBroadcast("editSession.created", (data) => {
        const d = data as { resourceType?: string; resourceId?: string };
        if (
          (!d.resourceType || d.resourceType === resourceType) &&
          (!d.resourceId || d.resourceId === resourceId)
        ) {
          refresh();
        }
      }),
      mcpBridge.onBroadcast("editSession.attached", (data) => {
        const d = data as { editSessionId?: string };
        if (d.editSessionId) refresh();
      }),
      mcpBridge.onBroadcast("editSession.detached", (data) => {
        const d = data as { editSessionId?: string };
        if (d.editSessionId) refresh();
      }),
      mcpBridge.onBroadcast("editSession.discarded", (data) => {
        const d = data as { editSessionId?: string };
        if (d.editSessionId) refresh();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [resourceType, resourceId, fetchSessions]);

  if (activeSessions.length === 0) return null;

  const tooltip = buildTooltip(activeSessions);

  return (
    <span
      className="edit-session-badge"
      title={tooltip}
      data-testid="edit-session-badge"
    >
      📝 {activeSessions.length}
    </span>
  );
}
