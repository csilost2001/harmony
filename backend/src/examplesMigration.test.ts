/**
 * R-4 #853 examples 物理 migration の統合テスト
 *
 * 4 件の examples が harmony.json + harmony/ (dataDir) 形式に正しく migration されたことを
 * projectStorage / workspaceInit 経由で検証する。
 *
 * 検証内容:
 * - inspectWorkspacePath → ready (harmony.json が AJV で valid)
 * - resolveDataRoot → examples/<id>/harmony を返す
 * - readProject → harmony.json を読めること
 * - readScreenFlowPositions (retail のみ) → screen-flow-positions.json が harmony/ 配下で読めること
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { inspectWorkspacePath } from "./workspaceInit.js";
import { resolveDataRoot, readProject, readScreenFlowPositions } from "./projectStorage.js";

const repoRoot = path.resolve(__dirname, "../..");

const EXAMPLES = [
  "retail",
  "english-learning",
  "english-learning-tailwind",
  "realestate",
] as const;

describe("R-4 #853 examples 物理 migration — harmony.json + dataDir 形式", () => {
  for (const exampleId of EXAMPLES) {
    const exampleDir = path.join(repoRoot, "examples", exampleId);

    describe(`examples/${exampleId}`, () => {
      it("inspectWorkspacePath → ready (harmony.json が AJV で valid)", async () => {
        const r = await inspectWorkspacePath(exampleDir);
        expect(r.status, `examples/${exampleId}: status=${r.status}${r.status === "invalid" ? ` reason=${(r as { reason?: string }).reason ?? ""}` : ""}`).toBe("ready");
      });

      it("resolveDataRoot → examples/<id>/harmony を返す", async () => {
        const dataRoot = await resolveDataRoot(exampleDir);
        const expected = path.join(exampleDir, "harmony");
        expect(dataRoot).toBe(expected);
      });

      it("readProject → harmony.json を読めること (null にならない)", async () => {
        const project = await readProject(exampleDir);
        expect(project).not.toBeNull();
        // harmony.json には schemaVersion と dataDir が必須
        const p = project as Record<string, unknown>;
        expect(p.schemaVersion).toBe("v3");
        expect(p.dataDir).toBe("harmony");
      });
    });
  }

  // retail 固有: screen-flow-positions.json が harmony/ 配下にある
  it("retail: readScreenFlowPositions → harmony/screen-flow-positions.json が読めること (null にならない)", async () => {
    const retailDir = path.join(repoRoot, "examples", "retail");
    const layout = await readScreenFlowPositions(retailDir);
    expect(layout).not.toBeNull();
  });
});
