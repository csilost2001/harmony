import type { Editor as GEditor } from "grapesjs";
import DOMPurify from "dompurify";
import { mcpBridge } from "../mcp/mcpBridge";
import { extractGrapesCss, extractGrapesHtml } from "../utils/pageLayoutCompositionPreview";
import type { GadgetBlockScreen } from "./blocks";

const GADGET_INSTANCE_SELECTOR = '[data-harmony-component="gadget-instance"][data-gadget-screen-id]';
const PREVIEW_ATTR = "data-harmony-gadget-preview";
const PREVIEW_CSS_ATTR = "data-harmony-gadget-preview-css";
const PREVIEW_SCOPE_ATTR = "data-harmony-gadget-preview-scope";

interface GadgetPreviewPayload {
  html: string | null;
  css: string;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function prefixSelectorList(selector: string, scopeSelector: string): string {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === ":root" || part === "html" || part === "body") return scopeSelector;
      return `${scopeSelector} ${part}`;
    })
    .join(",");
}

export function scopeGadgetPreviewCss(css: string, scopeSelector: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) {
      output += css.slice(cursor);
      break;
    }

    const selector = css.slice(cursor, open).trim();
    const close = findMatchingBrace(css, open);
    if (close === -1) {
      output += css.slice(cursor);
      break;
    }

    const body = css.slice(open + 1, close);
    if (selector.startsWith("@media") || selector.startsWith("@supports") || selector.startsWith("@container")) {
      output += `${selector}{${scopeGadgetPreviewCss(body, scopeSelector)}}`;
    } else if (selector.startsWith("@")) {
      output += `${selector}{${body}}`;
    } else if (selector) {
      output += `${prefixSelectorList(selector, scopeSelector)}{${body}}`;
    }
    cursor = close + 1;
  }

  return output;
}

export async function syncGadgetInstancePreviews(
  editor: GEditor,
  gadgets: GadgetBlockScreen[],
): Promise<void> {
  const canvasDoc = editor.Canvas.getDocument();
  if (!canvasDoc) return;

  const instances = Array.from(canvasDoc.querySelectorAll<HTMLElement>(GADGET_INSTANCE_SELECTOR));
  if (instances.length === 0) return;

  const gadgetNameMap = new Map(gadgets.map((gadget) => [gadget.id, gadget.name || gadget.id]));
  const ids = [...new Set(instances.map((el) => el.getAttribute("data-gadget-screen-id")).filter(Boolean) as string[])];
  const payloadMap = new Map<string, GadgetPreviewPayload>();

  await Promise.all(ids.map(async (id) => {
    try {
      const design = await mcpBridge.request("loadScreen", { screenId: id });
      payloadMap.set(id, {
        html: extractGrapesHtml(design),
        css: extractGrapesCss(design),
      });
    } catch {
      payloadMap.set(id, { html: null, css: "" });
    }
  }));

  instances.forEach((instance, index) => {
    const id = instance.getAttribute("data-gadget-screen-id") ?? "";
    const name = gadgetNameMap.get(id) ?? instance.getAttribute("data-gadget-screen-name") ?? id;
    instance.setAttribute("data-gadget-screen-name", name);

    const title = instance.querySelector<HTMLElement>(".harmony-gadget-instance__title");
    if (title) title.textContent = name;
    const idLabel = instance.querySelector<HTMLElement>(".harmony-gadget-instance__id");
    if (idLabel) idLabel.textContent = id;

    instance.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach((el) => el.remove());
    instance.querySelectorAll(`[${PREVIEW_CSS_ATTR}]`).forEach((el) => el.remove());
    const preview = canvasDoc.createElement("div");
    preview.setAttribute(PREVIEW_ATTR, "true");
    preview.setAttribute(PREVIEW_SCOPE_ATTR, `gadget-${index}`);
    preview.className = "harmony-gadget-instance__preview";

    const payload = payloadMap.get(id);
    if (payload?.css) {
      const style = canvasDoc.createElement("style");
      style.setAttribute(PREVIEW_CSS_ATTR, "true");
      style.textContent = scopeGadgetPreviewCss(
        payload.css,
        `[${PREVIEW_SCOPE_ATTR}="gadget-${index}"]`,
      );
      instance.appendChild(style);
    }

    if (payload?.html) {
      preview.innerHTML = DOMPurify.sanitize(payload.html);
    } else {
      preview.textContent = "Gadget design が見つかりません";
      preview.classList.add("is-empty");
    }

    instance.appendChild(preview);
  });
}
