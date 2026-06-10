import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sourceScript = join(repoRoot, "scripts", "migrate", "id-naming-2026-05-24.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function makeScriptFixture(): { root: string; script: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "harmony-id-migration-"));
  const migrateDir = join(root, "scripts", "migrate");
  mkdirSync(migrateDir, { recursive: true });
  const script = join(migrateDir, "id-naming-2026-05-24.ts");
  copyFileSync(sourceScript, script);
  return {
    root,
    script,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("id-naming-2026-05-24 migration script", () => {
  it("normalizes ProcessFlowEntry.kind even when the mapping has no processFlow records", () => {
    const fx = makeScriptFixture();
    try {
      writeJson(join(fx.root, "scripts", "migrate", "id-naming-2026-05-24-mapping.json"), {
        "metadata-only": {
          screen: [
            {
              uuid: "11111111-1111-4111-8111-111111111111",
              name: "Dashboard",
              id: "dashboard",
            },
          ],
        },
      });

      const workspace = join(fx.root, "workspace-under-test");
      mkdirSync(join(workspace, "harmony"), { recursive: true });
      writeJson(join(workspace, "harmony.json"), {
        schemaVersion: "v3",
        dataDir: "harmony",
        meta: {
          id: "workspace-under-test",
          uuid: "22222222-2222-4222-8222-222222222222",
          name: "Workspace Under Test",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
        entities: {
          processFlows: [
            {
              id: "daily-sync",
              name: "Daily Sync",
              kind: "common",
              actionCount: 1,
            },
          ],
        },
      });

      execFileSync(tsxBin, [
        fx.script,
        "--project-dir",
        workspace,
        "--mapping-key",
        "metadata-only",
      ], { cwd: repoRoot, stdio: "pipe" });

      const migrated = JSON.parse(readFileSync(join(workspace, "harmony.json"), "utf8"));
      expect(migrated.entities.processFlows[0]).toMatchObject({
        id: "daily-sync",
        flowType: "common",
      });
      expect(migrated.entities.processFlows[0]).not.toHaveProperty("kind");
    } finally {
      fx.cleanup();
    }
  });

  it("rejects --mapping-key without --project-dir", () => {
    const fx = makeScriptFixture();
    try {
      let stderr = "";
      let status = 0;
      try {
        execFileSync(tsxBin, [fx.script, "--mapping-key", "retail"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const err = error as { status?: number; stderr?: string };
        status = err.status ?? 1;
        stderr = err.stderr ?? "";
      }

      expect(status).toBe(1);
      expect(stderr).toContain("--mapping-key can only be used with --project-dir");
    } finally {
      fx.cleanup();
    }
  });

  it("rejects values on boolean flags", () => {
    const fx = makeScriptFixture();
    try {
      let stderr = "";
      let status = 0;
      try {
        execFileSync(tsxBin, [fx.script, "--dry-run=true"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const err = error as { status?: number; stderr?: string };
        status = err.status ?? 1;
        stderr = err.stderr ?? "";
      }

      expect(status).toBe(1);
      expect(stderr).toContain("--dry-run does not accept a value");
    } finally {
      fx.cleanup();
    }
  });
});
