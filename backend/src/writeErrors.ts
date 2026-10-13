/**
 * ファイルへ書けなかったときの原因を、対処つきの日本語にする。
 * 元のエラー (code・メッセージ) は cause に残す。画面の保存失敗の通知 (reportFailure) にそのまま出る。
 */
import path from "node:path";

const CAUSES: Record<string, string> = {
  ENOSPC: "ディスクの空き容量が足りません。不要なファイルを消して、もう一度保存してください",
  EDQUOT: "ディスクの利用上限 (クォータ) に達しています。不要なファイルを消して、もう一度保存してください",
  EACCES: "書き込む権限がありません。フォルダ・ファイルの権限を確認してください",
  EPERM: "書き込みが許可されていません。ファイルが他のプログラムで開かれていないか、権限を確認してください",
  EROFS: "読み取り専用のため書き込めません (読み取り専用でマウントされた場所の可能性があります)",
  EBUSY: "ファイルが他のプログラムに使われているため書き込めません。少し待って、もう一度保存してください",
  ENAMETOOLONG: "ファイル名またはフォルダの階層が長すぎます。ID を短くしてください",
  EMFILE: "同時に開いているファイルが多すぎます。少し待って、もう一度保存してください",
  ENFILE: "同時に開いているファイルが多すぎます。少し待って、もう一度保存してください",
};

/** 書き込みの失敗に、原因と対処を付けた Error を返す。原因が分からないものは、そのまま返す */
export function explainWriteError(err: unknown, filePath: string): unknown {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const cause = code ? CAUSES[code] : undefined;
  if (!cause) return err;
  const wrapped = new Error(`「${path.basename(filePath)}」を保存できませんでした: ${cause} (${code})`, { cause: err });
  (wrapped as NodeJS.ErrnoException).code = code;
  return wrapped;
}
