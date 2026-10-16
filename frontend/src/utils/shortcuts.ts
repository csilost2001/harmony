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
      { keys: ["Ctrl", "K", "→", "Alt", "Enter"], label: "探している候補を、いまの画面の右側に並べて開く (並べて表示)" },
      { keys: ["Ctrl", "K", "→", "Ctrl", "D"], label: "探している候補を、お気に入りに追加 / 解除 (ヘッダーの ★ から開けます)" },
      { keys: ["?"], label: "このショートカット一覧を開く" },
      { keys: ["Ctrl", "Tab"], label: "次のタブへ (Shift 付きで前のタブへ)" },
      { keys: ["Ctrl", "1〜9"], label: "n 番目のタブへ" },
      { keys: ["Ctrl", "W"], label: "いまのタブを閉じる" },
      { keys: ["Ctrl", "Shift", "PageUp / PageDown"], label: "いまのタブを左 / 右へ動かす (タブのドラッグの代わり)" },
      { keys: ["Ctrl", "Shift", "H"], label: "設計全体の検索置換 (名前・説明などの文章を、一覧で確かめて置き換える)" },
      { keys: ["Ctrl", "Alt", "M"], label: "AI への指示・質問 (マーカー) を追加 (テーブル・画面項目: フォーカスのある行について / 処理フロー: 工程の見出しにカーソルがあるとき)" },
      { keys: ["Ctrl", "Alt", "F"], label: "入力専用モード: ヘッダーとタブを畳んで、編集の画面だけにする (もう一度で戻す。右上のボタンでも戻せます)" },
      { keys: ["Ctrl", "Alt", "L"], label: "選んでいる工程・項目・カラム・部品・マーカーへの、直接のリンク (URL) をコピー (開くと、その要素へ移って強調します)" },
      { keys: ["F6"], label: "画面の領域 (ヘッダー → タブ → 一覧・詳細・マーカーなど) を順に移る (Shift 付きで逆順)" },
      { keys: ["Ctrl", "Shift", "P"], label: "操作を探して実行する (コマンドパレット。Ctrl+K のあと「>」でも同じ)" },
    ],
  },
  {
    title: "編集中",
    entries: [
      { keys: ["Ctrl", "S"], label: "保存 (入力欄にカーソルがあっても効く)" },
      { keys: ["Ctrl", "F"], label: "この画面の中を検索 (入力欄の値も探します。Enter = 次、Shift+Enter = 前、Esc = 閉じて、見つけた欄へ移る)" },
      { keys: ["Ctrl", "Z"], label: "元に戻す" },
      { keys: ["Ctrl", "Y"], label: "やり直し (Ctrl+Shift+Z も可)" },
      { keys: ["Ctrl", "Space"], label: "参照の入力欄で、補完の候補を開く (@ を打つと自動で開きます。↑↓ で選び、Tab / Enter で確定、Esc で閉じる)" },
      { keys: ["F12"], label: "参照 (@screen.cart など) の上にカーソルがあるとき、その定義を開く (Ctrl+クリックも可)" },
      { keys: ["Shift", "F12"], label: "参照 (@screen.cart など) の上にカーソルがあるとき、その設計を参照している設計の一覧 (参照元) を開く" },
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
      { keys: ["Alt", "↑↓"], label: "選んだ項目を上下へ動かす (ページレイアウトの region は、行の入力欄からも。Alt+Delete で削除)" },
      { keys: ["Shift", "F10"], label: "右クリックメニューを開く (メニューキーも可。タッチは行の長押し)" },
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
      { keys: ["Shift", "↑↓"], label: "選択を広げる (最上位の工程どうし。Ctrl+C / X / Delete などを、まとめて使えます)" },
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
      { keys: ["Ctrl", "D"], label: "表の入力欄: 1 つ上の行の同じ列の値を写す (「下方向へコピー」)" },
      { keys: ["Ctrl", "Enter"], label: "表の入力欄 (画面項目・テーブルのカラム): この行の下に、空の行を挿入" },
      { keys: ["Ctrl", "Shift", "Enter"], label: "表の入力欄 (画面項目・テーブルのカラム): この行を複製 (元の行の下)" },
      { keys: ["Alt", "Delete"], label: "表の入力欄 (画面項目・テーブルのカラム): この行を削除 (Ctrl+Z で戻せます)" },
      { keys: ["Alt", "↑↓"], label: "表の入力欄 (画面項目・テーブルのカラム・ビュー定義のカラム): この行を 1 つ上 / 下へ動かす (行頭のつまみのドラッグでも)" },
      { keys: ["ドラッグ"], label: "選んだ欄の右下の四角を上下へドラッグ: 値を埋める (Ctrl を押しながらで、末尾の数字・日付を 1 つずつ進める)" },
      { keys: ["Esc"], label: "入力欄から出る (もう一度で編集パネルを閉じる)" },
    ],
  },
  {
    title: "図 (ER 図・画面フロー)",
    entries: [
      { keys: ["Tab"], label: "次のテーブル / 画面 (ノード) へフォーカスを移す (Shift+Tab で前へ)" },
      { keys: ["Enter"], label: "フォーカスのあるテーブル / 画面を開く (ダブルクリックの代わり)" },
      { keys: ["矢印"], label: "選んでいるテーブル / 画面を動かす (編集中。保存の対象になります)" },
      { keys: ["+", "−"], label: "図の拡大 / 縮小 (0 で等倍、F で全体を収める、Z で選んでいる部品へ寄る)" },
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
      { keys: ["/", "または Insert"], label: "部品を追加するメニューを開く (種類を打ち込んで Enter。選んでいる部品の後ろに追加)" },
      { keys: ["Ctrl", "D"], label: "選んだ部品を複製" },
      { keys: ["Delete"], label: "選んだ部品を削除" },
      { keys: ["F2"], label: "選んだ部品の文言 (見出し・文章・ボタン・表題・項目の表示名) を、その場で直す (ダブルクリックも可。Enter で確定、Esc で取り消し、Tab で次の文言へ)" },
      { keys: ["Shift", "F10"], label: "選んだ部品の右クリックメニュー (複製・包む・外へ出す・独自部品として登録 など。メニューキーも可。タッチは長押し)" },
      { keys: ["Ctrl", "クリック"], label: "部品を、選択に加える / 外す (Shift+クリックで範囲、Shift+↑↓ で前後へ広げる、Ctrl+A で同じ入れ物の中すべて)。複数選択では、複製・削除・移動・包む・共通の属性の変更をまとめて行えます" },
      { keys: ["Alt", "Shift", "←→"], label: "選んだ段 (段組の中) の幅を、右隣の段とのあいだで 1 つぶん動かす (境界のドラッグでも)" },
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

/** 開いている画面に関係するグループ (ヘルプで、先頭に出して開いておく)。「どこでも」「編集中」は、どの画面でも関係する */
export function relevantGroupTitles(pathname: string): string[] {
  const rest = pathname.replace(/^\/w\/[^/]+/, "") || "/";
  const out = ["どこでも"];
  const isEdit = /\/(edit|items|design)\//.test(rest) || /^\/(conventions\/catalog|generic-definition)/.test(rest);
  if (isEdit) out.push("編集中");
  if (rest === "/") out.push("ダッシュボード");
  if (/\/list$|^\/generic-definition/.test(rest)) out.push("一覧 (画面・テーブル・処理フローなど)");
  if (/^\/(screen\/flow|table\/er)/.test(rest)) out.push("図 (ER 図・画面フロー)");
  if (/^\/process-flow\/edit\//.test(rest)) out.push("処理フロー (工程の見出しにカーソルがあるとき)");
  if (/^\/(table\/edit|screen\/items|view-definition\/edit)\//.test(rest) || /^\/conventions\/catalog/.test(rest)) out.push("表の入力 (画面項目・規約カタログ・ビュー定義・テーブルのカラム)");
  if (/^\/screen\/design\//.test(rest)) out.push("画面デザイナ");
  return out;
}
