/**
 * キーボードショートカットの一覧 (ヘルプ表示用)。実際のキー処理は各フックにある:
 * useTabKeyboard / useSaveShortcut / useUndoKeyboard / useListKeyboard / QuickOpen / 画面デザイナ。
 * 変更したらここも直す (ヘルプが実際と食い違うと混乱するため)。
 */
export interface ShortcutEntry { keys: string[]; label: string }
export interface ShortcutGroup { title: string; entries: ShortcutEntry[] }

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "どこでも",
    entries: [
      { keys: ["Ctrl", "K"], label: "画面・テーブル・処理フローなどを探して開く" },
      { keys: ["?"], label: "このショートカット一覧を開く" },
      { keys: ["Ctrl", "Tab"], label: "次のタブへ (Shift 付きで前のタブへ)" },
      { keys: ["Ctrl", "1〜9"], label: "n 番目のタブへ" },
      { keys: ["Ctrl", "W"], label: "いまのタブを閉じる" },
    ],
  },
  {
    title: "編集中",
    entries: [
      { keys: ["Ctrl", "S"], label: "保存 (入力欄にカーソルがあっても効く)" },
      { keys: ["Ctrl", "Z"], label: "元に戻す" },
      { keys: ["Ctrl", "Y"], label: "やり直し (Ctrl+Shift+Z も可)" },
    ],
  },
  {
    title: "一覧 (画面・テーブル・処理フローなど)",
    entries: [
      { keys: ["↑", "↓"], label: "選択を移動 (カード表示では ← → も)" },
      { keys: ["Home", "End"], label: "先頭 / 末尾へ" },
      { keys: ["Ctrl", "A"], label: "すべて選択" },
      { keys: ["Enter"], label: "選んだ 1 件を開く (F2 も可)" },
      { keys: ["Ctrl", "C"], label: "コピー (Ctrl+X で切り取り、Ctrl+V で貼り付け)" },
      { keys: ["Ctrl", "D"], label: "複製" },
      { keys: ["Delete"], label: "削除" },
      { keys: ["Alt", "↑↓"], label: "選んだ項目を上下へ動かす" },
      { keys: ["Shift", "F10"], label: "右クリックメニューを開く (メニューキーも可)" },
      { keys: ["Esc"], label: "選択・コピーを解除" },
    ],
  },
  {
    title: "画面デザイナ",
    entries: [
      { keys: ["Alt", "↑↓"], label: "選んだ部品を上下へ動かす" },
      { keys: ["Ctrl", "D"], label: "選んだ部品を複製" },
      { keys: ["Delete"], label: "選んだ部品を削除" },
    ],
  },
];

/** 「?」キーでヘルプを開いてよい状況か (入力中は開かない) */
export function shouldOpenShortcutHelp(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (t?.isContentEditable) return false;
  return true;
}
