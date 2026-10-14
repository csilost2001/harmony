import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import zlib from "node:zlib";
import { MAX_ZIP_ENTRY_BYTES } from "@harmony/shared";
import { MAX_IMPORT_FILE_BYTES, inflateRaw, readFileBytes } from "./inflate";

describe("inflateRaw (ブラウザの DecompressionStream)", () => {
  // jsdom の Blob には stream() が無い (本物のブラウザにはある)。Node の Blob に差し替えて試す
  beforeAll(() => { vi.stubGlobal("Blob", NodeBlob); });
  afterAll(() => { vi.unstubAllGlobals(); });
  it("deflate (生) を展開する", async () => {
    const raw = new TextEncoder().encode("あいうえお".repeat(1000));
    const out = await inflateRaw(new Uint8Array(zlib.deflateRawSync(raw)));
    expect(new TextDecoder().decode(out)).toBe("あいうえお".repeat(1000));
  });
  it("壊れたデータは失敗する", async () => {
    await expect(inflateRaw(new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toThrow();
  });
  it("展開後が大きすぎるもの (ZIP 爆弾) は、途中で止める", async () => {
    const bomb = new Uint8Array(zlib.deflateRawSync(new Uint8Array(MAX_ZIP_ENTRY_BYTES + 1024 * 1024)));
    expect(bomb.length).toBeLessThan(200_000); // 小さな入力が
    await expect(inflateRaw(bomb)).rejects.toThrow("大きすぎます");
  }, 30_000);
  it("取り込むファイルは 20 MB まで (読む前に断る)", async () => {
    expect(MAX_IMPORT_FILE_BYTES).toBe(20 * 1024 * 1024);
    await expect(readFileBytes({ size: MAX_IMPORT_FILE_BYTES + 1 } as File)).rejects.toThrow("ファイルが大きすぎます");
    expect(await readFileBytes(new File(["abc"], "a.txt"))).toEqual(new Uint8Array([97, 98, 99]));
  });
});
