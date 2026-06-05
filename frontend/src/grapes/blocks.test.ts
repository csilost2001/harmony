import { describe, expect, it, vi } from "vitest";
import type { Editor } from "grapesjs";
import {
  GADGET_BLOCK_CATEGORY,
  __testExports,
  registerGadgetBlocks,
} from "./blocks";

function makeEditor(existingIds: string[] = []) {
  const add = vi.fn();
  const remove = vi.fn((id: string) => {
    existingIds = existingIds.filter((existingId) => existingId !== id);
  });
  const get = vi.fn((id: string) => (
    existingIds.includes(id) ? { getId: () => id } : undefined
  ));
  const getAll = vi.fn(() => existingIds.map((id) => ({ getId: () => id })));
  const editor = {
    BlockManager: { add, remove, get, getAll },
  } as unknown as Editor;
  return { editor, add, remove, get, getAll };
}

describe("gadget blocks", () => {
  it("builds a reference placeholder instead of embedding gadget HTML", () => {
    const content = __testExports.buildGadgetBlockContent({
      id: "notice-gadget",
      name: "Notice <Gadget>",
    });

    expect(content).toContain('data-harmony-component="gadget-instance"');
    expect(content).toContain('data-gadget-screen-id="notice-gadget"');
    expect(content).toContain("Notice &lt;Gadget&gt;");
    expect(content).toContain("Gadget");
    expect(content).not.toContain("<script");
  });

  it("registers purpose=gadget screens as palette blocks and excludes the current screen", () => {
    const { editor, add, remove } = makeEditor();

    registerGadgetBlocks(
      editor,
      [
        { id: "current-gadget", name: "Current" },
        { id: "message-area", name: "Message Area" },
      ],
      "current-gadget",
    );

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      "gadget:message-area",
      expect.objectContaining({
        label: "Message Area",
        category: GADGET_BLOCK_CATEGORY,
        content: expect.stringContaining('data-gadget-screen-id="message-area"'),
      }),
    );
  });

  it("removes stale gadget blocks during the second sync", () => {
    const { editor, add, remove } = makeEditor(["gadget:old-message", "field-text"]);

    registerGadgetBlocks(
      editor,
      [{ id: "message-area", name: "Message Area" }],
      "page-a",
    );

    expect(remove).toHaveBeenCalledWith("gadget:old-message");
    expect(remove).not.toHaveBeenCalledWith("field-text");
    expect(add).toHaveBeenCalledWith(
      "gadget:message-area",
      expect.objectContaining({ label: "Message Area" }),
    );
  });

  it("removes an existing gadget block when it becomes the current screen", () => {
    const { editor, add, remove } = makeEditor(["gadget:message-area"]);

    registerGadgetBlocks(
      editor,
      [{ id: "message-area", name: "Message Area" }],
      "message-area",
    );

    expect(remove).toHaveBeenCalledWith("gadget:message-area");
    expect(add).not.toHaveBeenCalled();
  });

  it("refreshes label and content for existing gadget blocks", () => {
    const { editor, add, remove } = makeEditor(["gadget:message-area"]);

    registerGadgetBlocks(
      editor,
      [{ id: "message-area", name: "Renamed Gadget" }],
      "page-a",
    );

    expect(remove).toHaveBeenCalledWith("gadget:message-area");
    expect(add).toHaveBeenCalledWith(
      "gadget:message-area",
      expect.objectContaining({
        label: "Renamed Gadget",
        content: expect.stringContaining('data-gadget-screen-name="Renamed Gadget"'),
      }),
    );
  });
});
