import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type StaticResolution =
  | { kind: "file"; filePath: string; contentType: string; immutable: boolean }
  | { kind: "notFound" };

function isPathContained(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parsePathname(url: string): string | null {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function resolveStaticAsset(staticRoot: string, url: string): Promise<StaticResolution> {
  const pathname = parsePathname(url);
  if (!pathname) return { kind: "notFound" };

  const root = path.resolve(staticRoot);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return { kind: "notFound" };
  }
  const requested = decodedPath === "/" ? "/index.html" : decodedPath;
  const candidate = path.resolve(root, `.${requested}`);

  if (!isPathContained(candidate, root)) return { kind: "notFound" };

  if (await fileExists(candidate)) {
    const ext = path.extname(candidate).toLowerCase();
    return {
      kind: "file",
      filePath: candidate,
      contentType: MIME_TYPES[ext] ?? "application/octet-stream",
      immutable: candidate.includes(`${path.sep}_astro${path.sep}`),
    };
  }

  if (path.extname(requested) !== "") return { kind: "notFound" };

  const indexPath = path.join(root, "index.html");
  if (await fileExists(indexPath)) {
    return {
      kind: "file",
      filePath: indexPath,
      contentType: MIME_TYPES[".html"],
      immutable: false,
    };
  }

  return { kind: "notFound" };
}

export function createStaticAssetHandler(staticRoot: string) {
  const root = path.resolve(staticRoot);

  return async function handleStaticAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain", "Allow": "GET, HEAD" });
      res.end("Method Not Allowed");
      return;
    }

    const resolved = await resolveStaticAsset(root, req.url ?? "/");
    if (resolved.kind === "notFound") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": resolved.contentType,
      "Cache-Control": resolved.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(resolved.filePath).pipe(res);
  };
}
