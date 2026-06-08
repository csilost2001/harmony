import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "grapesjs";
import { scopeGadgetPreviewCss, syncGadgetInstancePreviews } from "./gadgetInstancePreview";
import { mcpBridge } from "../mcp/mcpBridge";

vi.mock("../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: vi.fn(),
  },
}));

function makeEditor(html: string) {
  document.body.innerHTML = html;
  return {
    Canvas: {
      getDocument: () => document,
    },
  } as unknown as Editor;
}

describe("syncGadgetInstancePreviews", () => {
  beforeEach(() => {
    vi.mocked(mcpBridge.request).mockReset();
  });

  it("no-ops while the GrapesJS canvas document is not initialized yet", async () => {
    const editor = {
      Canvas: {
        getDocument: () => null,
      },
    } as unknown as Editor;

    await expect(syncGadgetInstancePreviews(editor, [{ id: "message-area", name: "Message Area" }])).resolves.toBeUndefined();

    expect(mcpBridge.request).not.toHaveBeenCalled();
  });

  it("expands placed gadget references with the referenced gadget design HTML", async () => {
    vi.mocked(mcpBridge.request).mockResolvedValue({
      pages: [{ frames: [{ component: { components: '<section class="message-card"><strong>Gadget Body</strong></section>' } }] }],
      styles: [
        { selectors: [{ name: "message-card", type: 1 }], style: { color: "red", "font-weight": "700" } },
      ],
    });
    const editor = makeEditor(`
      <section class="message-card">Consuming screen body</section>
      <div
        class="harmony-gadget-instance"
        data-harmony-component="gadget-instance"
        data-gadget-screen-id="message-area"
        data-gadget-screen-name="Old Name"
      >
        <div class="harmony-gadget-instance__title">Old Name</div>
        <div class="harmony-gadget-instance__id">message-area</div>
      </div>
    `);

    await syncGadgetInstancePreviews(editor, [{ id: "message-area", name: "Message Area" }]);

    expect(mcpBridge.request).toHaveBeenCalledWith("loadScreen", { screenId: "message-area" });
    expect(document.querySelector(".harmony-gadget-instance__title")?.textContent).toBe("Message Area");
    expect(document.querySelector("[data-harmony-gadget-preview]")?.innerHTML).toContain("Gadget Body");
    const css = document.querySelector("[data-harmony-gadget-preview-css]")?.textContent ?? "";
    expect(css).toContain('[data-harmony-gadget-preview-scope="gadget-0"] .message-card{');
    expect(css).not.toMatch(/(^|})\.message-card\{/);
    expect(css).toContain("color:red;");
    expect(document.querySelector(".harmony-gadget-instance")?.getAttribute("data-gadget-screen-name")).toBe("Message Area");
  });

  it("replaces stale previews instead of nesting duplicate copies", async () => {
    vi.mocked(mcpBridge.request).mockResolvedValue({
      pages: [{ frames: [{ component: { components: "<section>Fresh</section>" } }] }],
    });
    const editor = makeEditor(`
      <div
        class="harmony-gadget-instance"
        data-harmony-component="gadget-instance"
        data-gadget-screen-id="message-area"
      >
        <style data-harmony-gadget-preview-css="true">.old{color:gray;}</style>
        <div data-harmony-gadget-preview="true">Stale</div>
      </div>
    `);

    await syncGadgetInstancePreviews(editor, [{ id: "message-area", name: "Message Area" }]);

    expect(document.querySelectorAll("[data-harmony-gadget-preview]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-harmony-gadget-preview-css]")).toHaveLength(0);
    expect(document.querySelector("[data-harmony-gadget-preview]")?.textContent).toBe("Fresh");
  });

  it("shows a missing-design placeholder when the referenced gadget cannot be loaded", async () => {
    vi.mocked(mcpBridge.request).mockRejectedValue(new Error("missing"));
    const editor = makeEditor(`
      <div
        class="harmony-gadget-instance"
        data-harmony-component="gadget-instance"
        data-gadget-screen-id="missing-gadget"
      ></div>
    `);

    await syncGadgetInstancePreviews(editor, [{ id: "missing-gadget", name: "Missing Gadget" }]);

    const preview = document.querySelector("[data-harmony-gadget-preview]");
    expect(preview?.textContent).toBe("Gadget design が見つかりません");
    expect(preview?.classList.contains("is-empty")).toBe(true);
  });

  it("scopes gadget CSS inside media rules as well", () => {
    const scoped = scopeGadgetPreviewCss(
      ".message-card{color:red;}\n@media (max-width: 600px){.message-card{display:block;}}",
      '[data-harmony-gadget-preview-scope="gadget-0"]',
    );

    expect(scoped).toContain('[data-harmony-gadget-preview-scope="gadget-0"] .message-card{color:red;}');
    expect(scoped).toContain('@media (max-width: 600px){[data-harmony-gadget-preview-scope="gadget-0"] .message-card{display:block;}}');
    expect(scoped).not.toMatch(/(^|})\.message-card\{/);
  });
});
