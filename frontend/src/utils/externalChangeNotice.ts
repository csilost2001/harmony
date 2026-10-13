/**
 * 設計ファイルが backend の外 (エディタ・git・別の AI など) で書き換えられたときの知らせ。
 * 開いている編集画面の読み直し・「他で更新されました」の帯は、各画面が `<種類>Changed` で行う。ここは、その全体の通知 (トースト)。
 * 仕様: docs/spec/external-change-detection.md
 */
import { mcpBridge } from "../mcp/mcpBridge";
import { showToast } from "./toast";

/** 変わったファイル (データフォルダからの相対パス) の通知文 */
export function externalChangeText(paths: readonly string[]): string {
  const names = paths.map((p) => p.replace(/\.design\.json$/, ".json"));
  const uniq = [...new Set(names)];
  const head = uniq.slice(0, 2).join("、");
  const rest = uniq.length > 2 ? ` ほか ${uniq.length - 2} 件` : "";
  return `設計ファイルが外部で更新されました: ${head}${rest}`;
}

let installed = false;
export function installExternalChangeNotice(): void {
  if (installed) return;
  installed = true;
  mcpBridge.onBroadcast("externalFilesChanged", (data) => {
    const paths = (data as { paths?: unknown } | null)?.paths;
    if (!Array.isArray(paths) || paths.length === 0) return;
    showToast(externalChangeText(paths.filter((p): p is string => typeof p === "string")), "info");
  });
}
