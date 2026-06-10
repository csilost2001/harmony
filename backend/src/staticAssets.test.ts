import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStaticAsset } from "./staticAssets.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harmony-static-"));
  await mkdir(path.join(root, "_astro"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html><div id=\"root\"></div>");
  await writeFile(path.join(root, "_astro", "app.js"), "console.log('ok');");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveStaticAsset", () => {
  it("serves concrete static files", async () => {
    const resolved = await resolveStaticAsset(root, "/_astro/app.js");

    expect(resolved.kind).toBe("file");
    if (resolved.kind === "file") {
      expect(resolved.filePath).toBe(path.join(root, "_astro", "app.js"));
      expect(resolved.contentType).toBe("text/javascript; charset=utf-8");
      expect(resolved.immutable).toBe(true);
    }
  });

  it("falls back to index.html for SPA routes", async () => {
    const resolved = await resolveStaticAsset(root, "/w/ws-1/screen/list");

    expect(resolved.kind).toBe("file");
    if (resolved.kind === "file") {
      expect(resolved.filePath).toBe(path.join(root, "index.html"));
      expect(resolved.immutable).toBe(false);
    }
  });

  it("does not fall back for missing asset-like paths", async () => {
    await expect(resolveStaticAsset(root, "/missing.js")).resolves.toEqual({ kind: "notFound" });
  });

  it("rejects path traversal", async () => {
    await expect(resolveStaticAsset(root, "/%2e%2e/package.json")).resolves.toEqual({ kind: "notFound" });
  });
});
