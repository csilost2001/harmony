import { describe, expect, it } from "vitest";
import { friendlyLabel, participantLabel } from "./participantLabel";

const SID = "920fa283-0e8f-4467-9c88-9d3acd4ca95a";

describe("participantLabel", () => {
  it("表示名が無い・セッション ID そのものなら「ゲスト (先頭 4 文字)」", () => {
    expect(participantLabel("", SID)).toBe("ゲスト (920f)");
    expect(participantLabel(undefined, SID)).toBe("ゲスト (920f)");
    expect(participantLabel(SID, SID)).toBe("ゲスト (920f)");
    expect(participantLabel("11111111-2222-3333-4444-555555555555", SID)).toBe("ゲスト (1111)");
  });
  it("利用者が付けた名前・AI の表示名はそのまま", () => {
    expect(participantLabel("@alice", SID)).toBe("@alice");
    expect(participantLabel("Alice@AI", SID)).toBe("Alice@AI");
  });
  it("friendlyLabel: UUID のときだけ直し、空は「ゲスト」", () => {
    expect(friendlyLabel(SID)).toBe("ゲスト (920f)");
    expect(friendlyLabel("@bob")).toBe("@bob");
    expect(friendlyLabel("")).toBe("ゲスト");
  });
});
