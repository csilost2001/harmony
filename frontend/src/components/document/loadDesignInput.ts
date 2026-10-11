/**
 * 設計書の入力 (画面・処理フロー・テーブル・規約・業務フロー・帳票など) を、ワークスペースから読み集める。
 * 設計書ビューとダッシュボードの「設計の要確認」パネルが共有する。
 *
 * 読み集めは backend の 1 回の問い合わせ (`loadDesignInput`) で済ませる。設計ごとに問い合わせると、
 * 大きなプロジェクト (画面 300・テーブル 170 ほか) で数千回の往復になり、サーバが他の操作に応えられなくなる。
 */
import type { DesignDocInput } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";

/**
 * 設計書の入力と、読めなかったために載らないもの。
 * 読めなかったものを黙って捨てると、「問題なし」の検査になってしまうため、`skipped` に積んで呼び出し側が示す。
 * スキーマに合っていない点 (要確認) も入力に含まれる (`extraIssues`)。
 */
export async function loadDesignInput(): Promise<{ input: DesignDocInput; skipped: string[] }> {
  const res = await mcpBridge.request("loadDesignInput") as { input?: DesignDocInput; skipped?: string[] } | null;
  if (!res?.input) throw new Error("設計書の入力を読めませんでした");
  return { input: res.input, skipped: Array.isArray(res.skipped) ? res.skipped : [] };
}
