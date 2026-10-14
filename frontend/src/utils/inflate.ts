import { MAX_ZIP_ENTRY_BYTES } from "@harmony/shared";

/** ZIP の deflate (生) を展開する (ブラウザの DecompressionStream)。展開後が大きすぎるものは、途中で止める (ZIP 爆弾) */
export async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("このブラウザは、圧縮されたファイルの展開に対応していません (新しい Chrome / Edge / Firefox / Safari を使ってください)");
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ZIP_ENTRY_BYTES) { await reader.cancel(); throw new Error("ファイルの中身が大きすぎます (64 MB まで)"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** 取り込むファイルの大きさの上限 (読み込む前に断る) */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

export async function readFileBytes(file: File): Promise<Uint8Array> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error(`ファイルが大きすぎます (${Math.round(file.size / 1024 / 1024)} MB。${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB まで)`);
  return new Uint8Array(await file.arrayBuffer());
}
