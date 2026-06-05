import type { EditorKind } from "../../utils/resolveEditorKind";

export type DesignerDraftResourceType = "screen" | "page-layout-design" | "puck-data";

export interface EditSessionListResult {
  sessions: Array<{
    state?: string;
    participants?: Record<string, unknown>;
  }>;
}

export function getDesignerDraftResourceType(editorKind: EditorKind): DesignerDraftResourceType {
  return editorKind === "puck" ? "puck-data" : "screen";
}

export function hasActiveParticipantSession(
  sessionsResult: EditSessionListResult | null | undefined,
  sessionId: string,
): boolean {
  return (sessionsResult?.sessions ?? []).some((session) =>
    session.state === "Active" && !!session.participants?.[sessionId],
  );
}
