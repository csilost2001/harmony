/**
 * ID・物理名の形式のチェックと、直し方の提案 (UI 改善提案 第 5 弾 #81・#100)。画面に依存しない純関数。
 * 欄の直下に、何が違うかと、直した値 (ワンクリックで採用) を出すための材料。
 * 形式は schema どおり: 画面項目の ID = camelCase (`^[a-z][a-zA-Z0-9]*$`)、物理名 = snake_case (`^[a-z][a-z0-9_]*$` 63 字まで)。
 */
export type IdStyle = "camel" | "snake";

const RE: Record<IdStyle, RegExp> = { camel: /^[a-z][a-zA-Z0-9]*$/, snake: /^[a-z][a-z0-9_]*$/ };
const MAX: Record<IdStyle, number> = { camel: 64, snake: 63 };
const EXAMPLE: Record<IdStyle, string> = { camel: "customerId", snake: "customer_id" };
const RULE: Record<IdStyle, string> = {
  camel: "英小文字で始まる英数字 (camelCase。例: customerId)",
  snake: "英小文字で始まる、英小文字・数字・下線 (snake_case。例: customer_id)",
};

export function isValidIdentifier(value: string, style: IdStyle): boolean {
  return RE[style].test(value) && value.length <= MAX[style];
}

/** 単語に分ける: 全角→半角、記号・空白で区切り、camelCase の境目 (aB) と数字の境目でも区切る */
function words(raw: string): string[] {
  return raw
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** 形式に直した値の案。直せない (英数字が 1 つも無い) ときは null */
export function suggestIdentifier(raw: string, style: IdStyle): string | null {
  const ws = words(raw).map((w) => w.toLowerCase());
  if (ws.length === 0) return null;
  let out = style === "snake" ? ws.join("_") : ws.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
  out = out.replace(/^[^a-z]+/, ""); // 先頭は英小文字
  if (!out) return null;
  return out.slice(0, MAX[style]);
}

export interface IdentifierHint {
  /** 欄の直下に出す文 */
  message: string;
  /** 直した値の案 (無ければ、直し方は示せない) */
  fix?: string;
}

/** 形式が合っていれば null。空欄は、必須として扱う (required=false なら null) */
export function identifierHint(value: string, style: IdStyle, required = true): IdentifierHint | null {
  if (value === "") return required ? { message: `必須です。${RULE[style]}` } : null;
  if (isValidIdentifier(value, style)) return null;
  const fix = suggestIdentifier(value, style);
  const reason = value.length > MAX[style] ? `${MAX[style]} 字までです` : /^[A-Za-z]/.test(value) === false ? "先頭は英小文字にします" : "使えない文字があります (空白・全角・記号・大文字小文字の混在)";
  return { message: `${reason}。${RULE[style]}`, ...(fix && fix !== value ? { fix } : {}) };
}

export { EXAMPLE as IDENTIFIER_EXAMPLES };
