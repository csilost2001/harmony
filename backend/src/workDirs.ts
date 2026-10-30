/**
 * ワークスペースの中に置く作業用のフォルダ (.harmony-backups / .harmony-journal / .harmony-progress /
 * .harmony-ops / .edit-sessions / .edit-sessions-history) の作り方をそろえる。
 *
 * どのフォルダも、中に `.gitignore` (`*`) を置いて「自分で自分を隠す」。ワークスペースのルートが
 * 業務アプリの git の作業場所と同じでも (dev + harmony の同居構成)、作業用のファイルが
 * `git add -A` で commit されないようにするため。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** 既にあれば何もしない。置けなくても (読み取り専用の場所など) 無視する */
export async function writeOwnGitignore(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
}

/** フォルダを (親ごと) 作り、自分の .gitignore を置く */
export async function ensureWorkDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await writeOwnGitignore(dir);
}
