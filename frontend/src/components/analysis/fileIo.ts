/** 設計の分析の画面の、ファイルの保存・コピー */
import { showToast } from "../../utils/toast";

/** 文字列をファイルとして保存する */
export function saveTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV の先頭に BOM を付ける (Excel で文字化けしないように) */
export const withBom = (csv: string): string => `${String.fromCharCode(0xfeff)}${csv}`;

export async function copyText(text: string, done = "コピーしました"): Promise<void> {
  try { await navigator.clipboard.writeText(text); showToast(done); } catch { showToast("コピーできませんでした (ブラウザの許可が要ります)", "error"); }
}
