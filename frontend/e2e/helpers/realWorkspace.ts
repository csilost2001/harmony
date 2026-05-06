import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RealWorkspaceFixture {
  key: string;
  sourcePath: string;
  workspacePath: string;
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".tmp", "e2e-workspaces");

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

export function tempWorkspacePath(key: string): string {
  return path.join(TMP_ROOT, key);
}

export async function copyExampleWorkspace(exampleName: string, key: string): Promise<RealWorkspaceFixture> {
  const sourcePath = repoPath("examples", exampleName);
  const workspacePath = tempWorkspacePath(key);
  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  await fs.cp(sourcePath, workspacePath, { recursive: true });
  return { key, sourcePath, workspacePath };
}

export async function cleanupRealWorkspaces(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) => fs.rm(tempWorkspacePath(key), { recursive: true, force: true })),
  );
}
