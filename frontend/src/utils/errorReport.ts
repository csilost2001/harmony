/**
 * エラーの報告用の文 (UI 改善提案 続編 第 10 弾 #200)。版・コミット・URL・開いている画面・直前の操作 5 件・エラーを、
 * ISSUE やチャットにそのまま貼れる Markdown にまとめる。画面に依存しない純関数。
 * 設計の中身・サーバのログ・利用者名は含めない (編集中の下書きは、種類と id だけ)。URL の ?token= などの秘密は伏せる。
 */
export interface ErrorReportInput {
  message: string;
  stack?: string;
  version?: { version?: string; commit?: string; branch?: string; dirty?: boolean };
  url?: string;
  /** 開いている画面の名前 (タブの名前) */
  screen?: string;
  /** 直前の操作 (新しい順。通知の履歴の文など) */
  recentOperations: ReadonlyArray<{ at: number; text: string }>;
  drafts?: ReadonlyArray<{ kind: string; id: string }>;
  userAgent?: string;
  capturedAt?: Date;
}

const MAX_OPS = 5;
const MAX_STACK_LINES = 12;

/** URL の問い合わせ・断片の、秘密になりうる値 (token・key・secret・password) を伏せる */
export function maskUrl(url: string): string {
  return url.replace(/([?&#][^=&#]*(?:token|key|secret|password|auth)[^=&#]*)=([^&#]*)/gi, "$1=●●●");
}

const two = (n: number) => String(n).padStart(2, "0");
const hms = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };

export function buildErrorReportText(i: ErrorReportInput): string {
  const v = i.version;
  const ver = v?.version ? `${v.version}${v.commit ? ` (${v.commit.slice(0, 8)}${v.branch ? `, ${v.branch}` : ""}${v.dirty ? ", 未コミットの変更あり" : ""})` : ""}` : "不明 (サーバに接続できませんでした)";
  const stackLines = (i.stack ?? "").split("\n").slice(0, MAX_STACK_LINES).join("\n");
  const ops = i.recentOperations.slice(0, MAX_OPS);
  const lines = [
    "## 不具合の報告 (Harmony)",
    "",
    `- 日時: ${(i.capturedAt ?? new Date()).toISOString()}`,
    `- 版: ${ver}`,
    ...(i.url ? [`- URL: ${maskUrl(i.url)}`] : []),
    ...(i.screen ? [`- 開いていた画面: ${i.screen}`] : []),
    ...(i.userAgent ? [`- ブラウザ: ${i.userAgent}`] : []),
    "",
    "### エラー",
    "```",
    i.message.trim() || "(メッセージなし)",
    "```",
    ...(stackLines ? ["", "<details><summary>スタックトレース (先頭)</summary>", "", "```", stackLines, "```", "", "</details>"] : []),
    "",
    `### 直前の操作 (新しい順に ${ops.length} 件)`,
    ...(ops.length ? ops.map((o) => `- ${hms(o.at)} ${o.text}`) : ["- (記録なし)"]),
    ...(i.drafts && i.drafts.length ? ["", `### 未保存の下書き (${i.drafts.length} 件。中身は含みません)`, ...i.drafts.slice(0, 10).map((d) => `- ${d.kind}: ${d.id}`)] : []),
    "",
    "### 何をしようとしていましたか (ここに書いてください)",
    "- ",
    "",
  ];
  return lines.join("\n");
}
