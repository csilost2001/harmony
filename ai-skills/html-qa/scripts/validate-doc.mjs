// html-qa: 議題 JSON (vN.json) の形式の検査。build.mjs と、ハブの publish (hub.mjs) が共有する。
import path from "node:path";

const COMMON = ["type"];
const QCOMMON = ["id", "q", "md", "required"];
export const SPEC = {
  text: { req: ["md"], opt: [] },
  note: { req: ["md"], opt: ["kind", "title"] },
  table: { req: ["rows"], opt: ["columns", "caption", "highlight"] },
  code: { req: ["code"], opt: ["lang", "caption"] },
  image: { req: ["src"], opt: ["caption", "alt"] },
  svg: { req: ["svg"], opt: ["caption"] },
  mermaid: { req: ["code"], opt: ["caption"] },
  html: { req: ["html"], opt: [] },
  compare: { req: ["options"], opt: [] },
  steps: { req: ["items"], opt: [] },
  kv: { req: ["items"], opt: [] },
  metrics: { req: ["items"], opt: [] },
  bars: { req: ["items"], opt: ["title", "unit", "max"] },
  details: { req: ["title"], opt: ["md", "blocks", "open"] },
  choice: { req: [...QCOMMON.slice(0, 2), "options"], opt: ["md", "required", "ref", "allowOther"], q: true },
  multi: { req: [...QCOMMON.slice(0, 2), "options"], opt: ["md", "required", "ref", "allowOther"], q: true },
  input: { req: QCOMMON.slice(0, 2), opt: ["md", "required", "ref", "placeholder", "lines"], q: true },
  scale: { req: QCOMMON.slice(0, 2), opt: ["md", "required", "ref", "min", "max", "step", "default", "unit", "minLabel", "maxLabel"], q: true },
  rank: { req: [...QCOMMON.slice(0, 2), "items"], opt: ["md", "required", "ref"], q: true },
  review: { req: [...QCOMMON.slice(0, 2), "items"], opt: ["md", "required", "ref"], q: true },
};
const NOTE_KINDS = ["info", "tip", "warn", "danger", "ok"];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validate(doc, file) {
  const errs = [];
  const warns = [];
  const e = (p, m) => errs.push(`${p}: ${m}`);
  const w = (p, m) => warns.push(`${p}: ${m}`);
  if (!doc || typeof doc !== "object") return { errs: ["(全体): JSON のオブジェクトではありません"], warns };
  const m = path.basename(file).match(/^v(\d+)\.json$/);
  if (!m) e("(ファイル名)", "vN.json の形にしてください (例: v1.json)");
  if (!TOPIC_RE.test(doc.topic ?? "")) e("topic", "英小文字・数字・ハイフンで指定してください (例: login-redesign)");
  else if (doc.topic !== path.basename(path.dirname(file))) e("topic", `フォルダ名 (${path.basename(path.dirname(file))}) と同じにしてください`);
  if (!Number.isInteger(doc.version) || doc.version < 1) e("version", "1 以上の整数にしてください");
  else if (m && Number(m[1]) !== doc.version) e("version", `ファイル名 v${m[1]} と一致しません`);
  if (typeof doc.title !== "string" || !doc.title.trim()) e("title", "必須です");
  for (const k of Object.keys(doc)) if (!["topic", "version", "title", "lead", "decisions", "newDecisions", "sections", "$comment"].includes(k)) w(k, "不明な項目です (無視されます)");
  if (doc.decisions != null) {
    if (!Array.isArray(doc.decisions)) e("decisions", "配列にしてください");
    else doc.decisions.forEach((d, i) => { if (!d?.title) e(`decisions[${i}]`, "title が必須です"); });
  }
  if (doc.newDecisions != null) {
    if (!Array.isArray(doc.newDecisions)) e("newDecisions", "配列にしてください");
    else doc.newDecisions.forEach((d, i) => { if (!d?.title) e(`newDecisions[${i}]`, "title が必須です"); });
  }
  if (!Array.isArray(doc.sections) || !doc.sections.length) { e("sections", "1 つ以上の章が必要です"); return { errs, warns }; }
  const qids = new Map();
  const walk = (blocks, base) => {
    if (!Array.isArray(blocks)) { e(base, "blocks は配列にしてください"); return; }
    blocks.forEach((b, i) => {
      const p = `${base}[${i}]`;
      const spec = typeof b?.type === "string" && Object.hasOwn(SPEC, b.type) ? SPEC[b.type] : undefined; // toString などの継承されたキーは型として認めない
      if (!spec) { e(p, `type "${b?.type}" は使えません (使えるもの: ${Object.keys(SPEC).join(", ")})`); return; }
      const where = `${p} (${b.type}${b.id ? ` ${b.id}` : ""})`;
      for (const r of spec.req) if (b[r] == null || b[r] === "") e(where, `${r} が必要です`);
      for (const k of Object.keys(b)) if (![...COMMON, ...spec.req, ...spec.opt].includes(k)) w(where, `不明な項目 "${k}" (無視されます)`);
      if (spec.q) {
        if (!ID_RE.test(b.id ?? "")) e(where, "id は英数字・_・- で指定してください (版をまたいで同じ質問には同じ id)");
        else if (qids.has(b.id)) e(where, `id "${b.id}" が ${qids.get(b.id)} と重複しています`);
        else qids.set(b.id, p);
        if (b.ref != null && (typeof b.ref !== "string" || !b.ref.trim())) e(where, "ref は文字列にしてください (例: processFlow:order-entry#step-3)");
      }
      const arr = (k) => { if (b[k] != null && !Array.isArray(b[k])) { e(where, `${k} は配列にしてください`); return false; } return Array.isArray(b[k]); };
      switch (b.type) {
        case "mermaid": if (typeof b.code !== "string") e(where, "code は文字列 (Mermaid の記法) にしてください"); break;
        case "note": if (b.kind && !NOTE_KINDS.includes(b.kind)) e(where, `kind は ${NOTE_KINDS.join(" / ")} のどれかです`); break;
        case "table": if (arr("rows")) b.rows.forEach((r, ri) => { if (!Array.isArray(r)) e(where, `rows[${ri}] は配列にしてください`); else if (b.columns && r.length !== b.columns.length) w(where, `rows[${ri}] の列数 ${r.length} が columns の ${b.columns.length} と違います`); }); break;
        case "choice": case "multi": case "rank": {
          const k = b.type === "rank" ? "items" : "options";
          if (arr(k)) {
            if (b[k].length < 2) e(where, `${k} は 2 つ以上必要です`);
            const seen = new Set();
            b[k].forEach((o, oi) => {
              const v = typeof o === "string" ? o : o?.value ?? o?.label;
              if (typeof o !== "string" && !o?.label) e(where, `${k}[${oi}] は文字列か { label } にしてください`);
              if (seen.has(v)) e(where, `${k}[${oi}] の値 "${v}" が重複しています`);
              seen.add(v);
            });
          }
          break;
        }
        case "review": if (arr("items")) { const seen = new Set(); b.items.forEach((it, ii) => { if (!ID_RE.test(it?.id ?? "")) e(where, `items[${ii}] に id が必要です`); else if (seen.has(it.id)) e(where, `items[${ii}] の id "${it.id}" が重複しています`); seen.add(it?.id); if (!it?.title && !it?.md) e(where, `items[${ii}] に title か md が必要です`); if (it?.ref != null && typeof it.ref !== "string") e(where, `items[${ii}] の ref は文字列にしてください`); }); } break;
        case "compare": if (arr("options")) b.options.forEach((o, oi) => { if (!o?.title) e(where, `options[${oi}] に title が必要です`); }); break;
        case "steps": case "metrics": case "bars": arr("items"); break;
        case "kv": if (arr("items")) b.items.forEach((x, xi) => { if (!Array.isArray(x) || x.length !== 2) e(where, `items[${xi}] は ["項目", "値"] の形にしてください`); }); break;
        case "scale": if (b.min != null && b.max != null && !(b.min < b.max)) e(where, "min は max より小さくしてください"); break;
        case "details": if (b.blocks) walk(b.blocks, `${p}.blocks`); break;
      }
    });
  };
  doc.sections.forEach((s, si) => {
    if (!s?.title) e(`sections[${si}]`, "title が必要です");
    walk(s?.blocks ?? [], `sections[${si}].blocks`);
  });
  if (!qids.size) w("(全体)", "質問がありません。説明だけの資料として作ります");
  return { errs, warns };
}
