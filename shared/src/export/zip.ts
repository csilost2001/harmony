/**
 * 最小の ZIP 書き出し (圧縮なし = stored)。Word (.docx)・Excel (.xlsx) は、中身が XML の ZIP なので、外部の依存なしに作る。
 * 名前は UTF-8 (汎用フラグのビット 11)。更新時刻は固定 (同じ入力から、同じバイト列になる)。
 */

const enc = new TextEncoder();
let table: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array | string }

// DOS 形式の固定の日時: 2026-01-01 00:00:00
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const header = concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name);
    chunks.push(header, data);
    central.push(concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    offset += header.length + data.length;
  }
  const centralBytes = concat(...central);
  const end = concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0));
  return concat(...chunks, centralBytes, end);
}

/** 展開後の 1 ファイルの上限 (inflate を渡す側も、この大きさで打ち切ること) */
export const MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
/** 展開後の合計の上限と、項目の数の上限 (小さな ZIP が、大量のメモリを使わせないように) */
export const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 10_000;

/** ZIP の中の、名前と中身 (圧縮なし・deflate のどちらも)。deflate の展開は、呼び出し側が渡す (Node: zlib、ブラウザ: DecompressionStream) */
export async function readZip(bytes: Uint8Array, inflate: (raw: Uint8Array) => Promise<Uint8Array>): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 末尾の「中央ディレクトリの終わり」を探す
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("ZIP として読めません (xlsx / docx ではないファイルです)");
  const count = dv.getUint16(eocd + 10, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`ZIP の中のファイルが多すぎます (${MAX_ZIP_ENTRIES} 個まで)`);
  let total = 0;
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP の中央ディレクトリが壊れています");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("ZIP の中のファイルが壊れています");
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    if (raw.length !== compSize) throw new Error("ZIP が途中で切れています");
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflate(raw));
    else throw new Error(`ZIP の圧縮方式 (${method}) には対応していません`);
    // 1 つのファイルの展開後が大きすぎる ZIP (爆弾) を止める
    if ((out.get(name)?.length ?? 0) > MAX_ZIP_ENTRY_BYTES) throw new Error("ZIP の中のファイルが大きすぎます (64 MB まで)");
    total += out.get(name)?.length ?? 0;
    if (total > MAX_ZIP_TOTAL_BYTES) throw new Error("ZIP の中身の合計が大きすぎます (256 MB まで)");
  }
  return out;
}
