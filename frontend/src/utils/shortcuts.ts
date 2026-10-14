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
      { keys: ["Ctrl", "K", "→", "Ctrl", "D"], label: "探している候補を、お気に入りに追加 / 解除 (ヘッダーの ★ から開けます)" },
      { keys: ["?"], label: "このショートカット一覧を開く" },
      { keys: ["Ctrl", "Tab"], label: "次のタブへ (Shift 付きで前のタブへ)" },
      { keys: ["Ctrl", "1〜9"], label: "n 番目のタブへ" },
      { keys: ["Ctrl", "W"], label: "いまのタブを閉じる" },
      { keys: ["Ctrl", "Shift", "PageUp / PageDown"], label: "いまのタブを左 / 右へ動かす (タブのドラッグの代わり)" },
      { keys: ["Ctrl", "Shift", "H"], label: "設計全体の検索置換 (名前・説明などの文章を、一覧で確かめて置き換える)" },
      { keys: ["Ctrl", "Shift", "P"], label: "操作を探して実行する (コマンドパレット。Ctrl+K のあと「>」でも同じ)" },
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
    title: "ダッシュボード",
    entries: [
      { keys: ["Alt", "矢印"], label: "パネルの見出しにカーソルがあるとき: パネルを 1 マス動かす" },
      { keys: ["Alt", "Shift", "矢印"], label: "パネルの大きさを 1 マス変える" },
    ],
  },
  {
    title: "処理フロー (工程の見出しにカーソルがあるとき)",
    entries: [
      { keys: ["↑", "↓"], label: "前後の工程へ移る (Home / End で最初・最後)" },
      { keys: ["→", "←"], label: "工程を開く・閉じる (Space でも切り替え)" },
      { keys: ["Enter"], label: "工程を開いて、最初の入力欄へ (F2 でも同じ)" },
      { keys: ["Insert"], label: "工程を挿入 (「/」でも可。種類を入力して Enter)" },
      { keys: ["Tab"], label: "直前の工程の配下へ入れる (インデント)" },
      { keys: ["Shift", "Tab"], label: "入れ子の工程をひとつ外へ出す (アウトデント)" },
      { keys: ["Esc"], label: "入力欄から工程の見出しへ戻る (Ctrl+Enter で次の工程を挿入)" },
    ],
  },
  {
    title: "表の入力 (画面項目・規約カタログ・ビュー定義・テーブルのカラム)",
    entries: [
      { keys: ["Enter"], label: "表の入力欄: 下の行の同じ列へ (画面項目は最後の行で値があれば行を追加)。Shift+Enter で上へ" },
      { keys: ["↑", "↓"], label: "表の入力欄: 文字を打つ欄から上下の行の同じ列へ" },
      { keys: ["Enter"], label: "カラムの編集パネル: 次の欄へ。最後の欄なら次のカラムへ (最後なら追加)" },
      { keys: ["Ctrl", "Enter"], label: "カラムの編集パネル: 次のカラムへ (Shift を足すと前へ)" },
      { keys: ["Esc"], label: "入力欄から出る (もう一度で編集パネルを閉じる)" },
    ],
  },
  {
    title: "画面デザイナ",
    entries: [
      { keys: ["↑", "↓"], label: "木の中で、前後の部品を選ぶ (見た目の順)" },
      { keys: ["←", "→"], label: "親の部品 / 最初の子の部品を選ぶ" },
      { keys: ["Alt", "↑↓"], label: "選んだ部品を同じ入れ物の中で上下へ動かす" },
      { keys: ["Alt", "←"], label: "選んだ部品を、入れ物の外へ出す (親の直後へ)" },
      { keys: ["Alt", "→"], label: "選んだ部品を、直前の入れ物の中へ入れる (最後の子として)" },
      { keys: ["Ctrl", "D"], label: "選んだ部品を複製" },
      { keys: ["Delete"], label: "選んだ部品を削除" },
      { keys: ["Esc"], label: "選択を外す" },
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
