import type { Data } from "@measured/puck";
import { mcpBridge } from "../mcp/mcpBridge";
import { regeneratePuckDataIds } from "../editor/puckIdRegeneration";
import type { EditorKind } from "../utils/resolveEditorKind";

export async function duplicateScreenDesignData(
  srcScreenId: string,
  dupScreenId: string,
  editorKind: EditorKind,
): Promise<void> {
  if (editorKind === "puck") {
    const src = await mcpBridge.loadPuckData(srcScreenId);
    if (!src) return;
    const regenerated = regeneratePuckDataIds(src as Data);
    await mcpBridge.savePuckData(dupScreenId, regenerated);
    return;
  }

  const src = await mcpBridge.request("loadScreen", { screenId: srcScreenId });
  if (!src) return;
  await mcpBridge.request("saveScreen", { screenId: dupScreenId, data: src });
}
