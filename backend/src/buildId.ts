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

/**
 * 起動中の環境 (HARMONY_STATIC_DIR) の版。呼ぶたびに読む (数十バイトの同期読み)。
 * dist を作り直した手動運用でも、静的配信 (リクエストごとにファイルを読む) と同じく新しい ID に追従する。
 */
export function getServerBuildId(): string | undefined {
  return readServerBuildId(process.env.HARMONY_STATIC_DIR);
}
