/**
 * rename (renameEntity.ts / renameRewriters.ts) が共通に使う、小さな部品。
 */
import * as fs from "node:fs/promises";
import type { RenameEntityType } from "./renameTypes.js";

export function escapeJsonPointerToken(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

export async function readFileContentOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

/** 各 entity 種別の主 dir (dataRoot 相対) */
export const ENTITY_PRIMARY_DIR: Record<RenameEntityType, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "process-flows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "view-definitions",
  pageLayout: "page-layouts",
};

