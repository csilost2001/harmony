import { describe, expect, it } from "vitest";
import { getDesignerDraftResourceType, hasActiveParticipantSession } from "./resumeDraft";

describe("designer resume draft helpers", () => {
  it("GrapesJS uses screen edit-session drafts", () => {
    expect(getDesignerDraftResourceType("grapesjs")).toBe("screen");
  });

  it("Puck uses puck-data edit-session drafts", () => {
    expect(getDesignerDraftResourceType("puck")).toBe("puck-data");
  });

  it("only treats my Active participant session as resumable", () => {
    expect(hasActiveParticipantSession({
      sessions: [
        { state: "Active", participants: { other: true } },
        { state: "Closed", participants: { me: true } },
        { state: "Active", participants: { me: true } },
      ],
    }, "me")).toBe(true);

    expect(hasActiveParticipantSession({
      sessions: [
        { state: "Active", participants: { other: true } },
        { state: "Closed", participants: { me: true } },
      ],
    }, "me")).toBe(false);
  });
});
