/**
 * 「いまの画面の操作」をコマンドパレット (Ctrl+K の「>」) に載せるための登録所。
 * 編集画面が、自分の操作 (カラムを追加・工程を挿入など) を `usePageCommands` で登録すると、
 * 画面が開いているあいだだけ、パレットに出る。操作はキー・ボタンと同じ処理を呼ぶ (パレット用に別の処理を持たない)。
 */
export interface PageCommand {
  id: string;
  label: string;
  /** 検索に使う別名 (読み・英語) */
  keywords: string[];
  /** Bootstrap Icons */
  icon: string;
  /** 補足 (ショートカットなど) */
  hint?: string;
  run: () => void;
}

const sources = new Map<string, () => readonly PageCommand[]>();
const listeners = new Set<() => void>();

/** 登録する。owner は画面ごとの名前 (同じ名前で登録し直すと置き換わる)。戻り値で解除する */
export function registerPageCommands(owner: string, get: () => readonly PageCommand[]): () => void {
  sources.set(owner, get);
  listeners.forEach((l) => l());
  return () => {
    if (sources.get(owner) === get) sources.delete(owner);
    listeners.forEach((l) => l());
  };
}

/** いま登録されている操作 (登録した順) */
export function getPageCommands(): PageCommand[] {
  return [...sources.values()].flatMap((get) => [...get()]);
}

export function onPageCommandsChange(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
