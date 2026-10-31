import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * このサーバが配る画面 (frontend) の版の識別子。
 * `vite build` が dist/build-id.txt に書く ID を、HARMONY_STATIC_DIR から読む (#1572)。
 * 静的配信なし (dev) やファイルが無い・空・不正な形のときは undefined。
 */
const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function readServerBuildId(staticDir: string | undefined): string | undefined {
  if (!staticDir) return undefined;
  try {
    const raw = readFileSync(path.join(staticDir, "build-id.txt"), "utf-8").trim();
    return BUILD_ID_PATTERN.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

let cached: { dir: string | undefined; id: string | undefined } | null = null;

/** 起動中の環境 (HARMONY_STATIC_DIR) の版。同じ dir の間は読み直さない (dist は起動中に変わらない前提) */
export function getServerBuildId(): string | undefined {
  const dir = process.env.HARMONY_STATIC_DIR;
  if (!cached || cached.dir !== dir) cached = { dir, id: readServerBuildId(dir) };
  return cached.id;
}
