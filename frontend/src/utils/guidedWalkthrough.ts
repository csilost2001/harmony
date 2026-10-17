/**
 * 初めての人のための、通しの案内 (UI 改善提案 続編 第 10 弾 #199)。受注の例で、テーブル → 画面 → 画面項目 → 処理フロー → 点検 → 設計書の順に、
 * 1 つの業務を最初から最後まで作る手順。各手順に、開く画面・入れる値の例・確認の仕方を持つ。画面に依存しない (手順のデータと、進み具合の保存)。
 * 進み具合 (終えた手順) は、このブラウザにだけ、ワークスペースごとに覚える。
 */
export interface WalkthroughStep {
  id: string;
  title: string;
  /** 何をするか (短い説明) */
  what: string;
  /** 手順 (箇条書き) */
  how: string[];
  /** 開く画面の経路 (ワークスペースの下) */
  route: string;
  routeLabel: string;
  /** 入れる値の例 (コピーして使える文。表から貼り付ける TSV など) */
  sample?: { label: string; text: string };
  /** できたかの確かめ方 */
  check: string;
}

/** カラムを貼り付ける表 (テーブル編集の「表から貼り付け」。タブ区切り: 物理名・表示名・型・長さ・必須・主キー) */
const COLUMNS_TSV = [
  "物理名\t表示名\tデータ型\t長さ\tNOT NULL\t主キー",
  "id\t注文ID\tBIGINT\t\tはい\tはい",
  "customer_name\t顧客名\tVARCHAR\t40\tはい\t",
  "ordered_on\t注文日\tDATE\t\tはい\t",
  "total_amount\t合計金額\tDECIMAL\t12\tはい\t",
].join("\n");

export const WALKTHROUGH_TITLE = "受注の例で、最初から最後まで作る";

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "table", title: "1. テーブルを作る (注文)", what: "データの置き場所と列を決めます。画面や処理は、このテーブルを見て作ります。",
    how: ["「テーブル一覧」で「テーブルを追加」。物理名は orders、表示名は「注文」(ID は物理名から自動で入る)", "編集を始め、「表から貼り付け」に、下の例を貼り付けてカラムをまとめて足す", "保存する (Ctrl+S)"],
    route: "/table/list", routeLabel: "テーブル一覧を開く",
    sample: { label: "カラムの例 (表から貼り付け)", text: COLUMNS_TSV },
    check: "テーブル一覧に「注文」が出て、カラムが 4 つある",
  },
  {
    id: "screen", title: "2. 画面を作る (注文入力)", what: "入力フォームとボタンを並べて、画面の形を決めます。",
    how: ["「画面一覧」で「画面を追加」。画面名は「注文入力」、ID は order-entry (日本語の名前からは入らないので、英数字で自分で入れる)", "一覧の「注文入力」をダブルクリックしてデザイナを開き、「編集開始」。左の「部品」の入力フォームとボタン群を、クリック (またはドラッグ) で置く", "保存する"],
    route: "/screen/list", routeLabel: "画面一覧を開く",
    check: "画面一覧に「注文入力」が出て、デザイナにフォームが見える",
  },
  {
    id: "items", title: "3. 画面項目を作る (テーブルから)", what: "フォームの入力欄を、テーブルのカラムから作ります (型・桁・必須が引き継がれます)。",
    how: ["画面一覧のカードの「項目定義」を開き、「編集開始」のあと「テーブルから作る」で「注文」を選ぶ", "候補を確かめて「追加」", "項目の ID・ラベル・必須を確かめて、保存する", "保存したら、画面項目の「破棄」で編集を終える (保存した内容は残る)。そのあとでデザイナを開くと、「前回の編集の続き」や「上書き確認」が出ない (同じ画面のデザインと項目定義は、別の編集として扱われ、編集中のまま開くと、お互いが「別の編集」に見えるため)"],
    route: "/screen/list", routeLabel: "画面一覧から「注文入力」を開く",
    check: "画面項目の表に、顧客名・注文日・合計金額の行がある",
  },
  {
    id: "flow", title: "4. 処理フローを書く (注文の登録)", what: "ボタンを押したときの処理を、入力チェック → DB への登録 → 画面遷移の順に書きます。",
    how: ["「処理フロー一覧」で「処理フローを作成」。名前は「注文を登録」、紐付け画面は「注文入力」、ID は order-create", "「アクション追加」(+) で「登録ボタン」を足し、左の「ブロック」から 入力チェック → DBアクセス → 画面遷移 の順にクリックして足す。各工程の「処理概要」に、やることを書く", "DBアクセスの「テーブル」は「注文」、「操作」は INSERT (登録) を選ぶ。画面遷移の「遷移先画面」は「注文入力」"],
    route: "/process-flow/list", routeLabel: "処理フロー一覧を開く",
    sample: { label: "DB アクセスの SQL の例", text: "INSERT INTO orders (customer_name, ordered_on, total_amount) VALUES (:customerName, :orderedOn, :totalAmount)" },
    check: "処理フローに 3 つの工程が並び、「テーブル」を参照している",
  },
  {
    id: "check", title: "5. 設計を点検する", what: "書き間違い・抜け・命名の食い違いを、自動で点検します。",
    how: ["「設計の分析」の「要確認」を開く", "エラー・警告の行をクリックして、該当の設計へ移って直す", "F8 で、次の要確認へ移れる"],
    route: "/analysis", routeLabel: "設計の分析を開く",
    check: "エラーが 0 件になる",
  },
  {
    id: "document", title: "6. 設計書にして渡す", what: "ここまでの設計を、1 つの設計書 (HTML・Word・Excel) にします。",
    how: ["「設計書」を開き、「体裁・改訂履歴」で表紙と版を設定する", "「HTML で保存」か「Word」で書き出す", "AI に頼むときは、設計のあゆみの「ファイルの場所」をコピーして渡せる"],
    route: "/document", routeLabel: "設計書を開く",
    check: "設計書に、注文のテーブル・画面・処理フローが載っている",
  },
];

const key = (wsId: string | undefined) => `harmony.walkthrough:${wsId ?? "default"}`;

export function loadWalkthroughDone(wsId: string | undefined): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key(wsId)) ?? "[]");
    const known = new Set(WALKTHROUGH_STEPS.map((s) => s.id));
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && known.has(x)) : []);
  } catch { return new Set(); }
}

export function saveWalkthroughDone(wsId: string | undefined, done: ReadonlySet<string>): void {
  try { localStorage.setItem(key(wsId), JSON.stringify([...done])); } catch { /* 保存できなくても、この画面の中では効く */ }
}

/** 次にやる手順 (終えていない最初のもの)。すべて終えていれば null */
export function nextStep(done: ReadonlySet<string>): WalkthroughStep | null {
  return WALKTHROUGH_STEPS.find((s) => !done.has(s.id)) ?? null;
}
