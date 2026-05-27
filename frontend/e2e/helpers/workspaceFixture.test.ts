/**
 * workspaceFixture.ts unit test (#1359 Round 1 Should-fix S-1)
 *
 * 本 helper の責務境界を vitest で固定化する。特に Round 1 Must-fix M-1 で発覚した
 * 「lockdown path は worker index 非依存でなければならない」契約を回帰させない
 * (将来 lockdownWorkspacePath を worker-prefix 化する変更で本 test が失敗する形で
 * regression を検出できる)。
 */
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  workerScopedPath,
  folderPickerFixtureRoot,
  lockdownWorkspacePath,
} from "./workspaceFixture.ts";

describe("workspaceFixture", () => {
  describe("workerScopedPath", () => {
    it("path に w<index>-<name> prefix を含む (workers > 1 衝突回避の核)", () => {
      const before = process.env.TEST_WORKER_INDEX;
      delete process.env.TEST_WORKER_INDEX;
      try {
        const p = workerScopedPath("sample-category", "my-fixture");
        expect(p).toMatch(/[\\/]\.tmp[\\/]sample-category[\\/]w0-my-fixture$/);
      } finally {
        if (before !== undefined) process.env.TEST_WORKER_INDEX = before;
      }
    });

    it("TEST_WORKER_INDEX=1 で w1- prefix が反映される (CI retry / 多 worker 想定)", () => {
      const before = process.env.TEST_WORKER_INDEX;
      process.env.TEST_WORKER_INDEX = "1";
      try {
        const p = workerScopedPath("cat", "name");
        expect(p.endsWith("w1-name")).toBe(true);
      } finally {
        if (before !== undefined) process.env.TEST_WORKER_INDEX = before;
        else delete process.env.TEST_WORKER_INDEX;
      }
    });
  });

  describe("folderPickerFixtureRoot", () => {
    it("workerScopedPath 経由で worker prefix が付く", () => {
      const before = process.env.TEST_WORKER_INDEX;
      delete process.env.TEST_WORKER_INDEX;
      try {
        const p = folderPickerFixtureRoot();
        expect(p).toMatch(/[\\/]\.tmp[\\/]e2e-folder-picker[\\/]w0-root$/);
      } finally {
        if (before !== undefined) process.env.TEST_WORKER_INDEX = before;
      }
    });
  });

  describe("lockdownWorkspacePath (Round 1 Must-fix M-1: stable / worker index 非依存)", () => {
    it("TEST_WORKER_INDEX=0 と TEST_WORKER_INDEX=1 で同一 path を返す (retry mismatch 回帰防止)", () => {
      const before = process.env.TEST_WORKER_INDEX;
      try {
        process.env.TEST_WORKER_INDEX = "0";
        const p0 = lockdownWorkspacePath();
        process.env.TEST_WORKER_INDEX = "1";
        const p1 = lockdownWorkspacePath();
        process.env.TEST_WORKER_INDEX = "5";
        const p5 = lockdownWorkspacePath();
        expect(p0).toBe(p1);
        expect(p0).toBe(p5);
      } finally {
        if (before !== undefined) process.env.TEST_WORKER_INDEX = before;
        else delete process.env.TEST_WORKER_INDEX;
      }
    });

    it("`.tmp/e2e-workspaces/lockdown-routing` で終わる (worker prefix を含まない)", () => {
      const p = lockdownWorkspacePath();
      const expectedSuffix = path.join(".tmp", "e2e-workspaces", "lockdown-routing");
      expect(p.endsWith(expectedSuffix)).toBe(true);
      // negative assertion: w<index>- prefix が一切含まれないこと (e.g. w0-lockdown / w1-lockdown)
      expect(p).not.toMatch(/w\d+-lockdown-routing/);
    });
  });
});
