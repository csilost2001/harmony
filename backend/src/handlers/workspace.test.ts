import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { handleWorkspaceTool } from "./workspace.js";
import { upsertWorkspaceRoot } from "../recentStore.js";
import {
  initWorkspaceState,
  workspaceContextManager,
  _resetForTest as resetWorkspaceState,
} from "../workspaceState.js";

const TMP_ROOT = path.join(os.tmpdir(), `workspace-tool-handler-test-${process.pid}-${Date.now()}`);
const ORIGINAL_RECENT_FILE = process.env.DESIGNER_RECENT_FILE;
const ORIGINAL_DATA_DIR = process.env.DESIGNER_DATA_DIR;
const SESSION_ID = "mcp-test-session";

beforeEach(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  process.env.DESIGNER_RECENT_FILE = path.join(TMP_ROOT, "recent-workspaces.json");
  delete process.env.DESIGNER_DATA_DIR;
  resetWorkspaceState();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetWorkspaceState();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  if (ORIGINAL_RECENT_FILE === undefined) {
    delete process.env.DESIGNER_RECENT_FILE;
  } else {
    process.env.DESIGNER_RECENT_FILE = ORIGINAL_RECENT_FILE;
  }
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DESIGNER_DATA_DIR;
  } else {
    process.env.DESIGNER_DATA_DIR = ORIGINAL_DATA_DIR;
  }
});

function enterLockdown(): void {
  process.env.DESIGNER_DATA_DIR = path.join(TMP_ROOT, "locked");
  initWorkspaceState();
  workspaceContextManager.connect(SESSION_ID);
}

function parseToolJson(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text);
}

describe("designer workspace tools lockdown behavior", () => {
  it("designer__workspace_list/status do not read recent in lockdown", async () => {
    await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    const list = await handleWorkspaceTool("designer__workspace_list", {}, TMP_ROOT, SESSION_ID);
    expect(parseToolJson(list)).toEqual({
      workspaces: [],
      lastActiveId: null,
      active: {
        id: "lockdown",
        path: path.resolve(process.env.DESIGNER_DATA_DIR!),
        name: null,
      },
      lockdown: true,
      lockdownPath: path.resolve(process.env.DESIGNER_DATA_DIR!),
    });

    const status = await handleWorkspaceTool("designer__workspace_status", {}, TMP_ROOT, SESSION_ID);
    expect(parseToolJson(status)).toEqual({
      active: {
        path: path.resolve(process.env.DESIGNER_DATA_DIR!),
        name: null,
      },
      lockdown: true,
      lockdownPath: path.resolve(process.env.DESIGNER_DATA_DIR!),
    });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("designer__workspace_open rejects before id lookup in lockdown", async () => {
    const root = await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    await expect(
      handleWorkspaceTool("designer__workspace_open", { id: root.id }, TMP_ROOT, SESSION_ID),
    ).rejects.toBeInstanceOf(McpError);
    expect(readSpy).not.toHaveBeenCalled();
  });
});
