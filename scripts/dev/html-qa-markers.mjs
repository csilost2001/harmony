#!/usr/bin/env node
// html-qa の回答 (vN.answer.json) を、Harmony のマーカー (designer__add_marker の引数) に変換する。
//
//   node scripts/dev/html-qa-markers.mjs <議題フォルダ> [--version N]
//
// 質問ブロックの ref で、どの設計への回答かを指す:
//   <種類>:<ID>                    設計全体       例: screen:login
//   processFlow:<ID>#<stepId>      処理フローの工程  例: processFlow:order-entry#step-3
//   <種類>:<ID>@<fieldPath>        設計の中の位置  例: table:orders@$.columns[col-02]  (fieldPath は $ で始まる)
// 種類: processFlow / screen / table / view / viewDefinition / sequence / pageLayout
//
// 出力は designer__add_marker に渡す引数の JSON 配列。ref が無い質問・未回答の質問は出さない。
// 終了コード: 0 = 出力した / 1 = ref の誤り / 2 = 回答 (vN.answer.json) が無い・引数の誤り
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENTITY_TYPES = ["processFlow", "screen", "table", "view", "viewDefinition", "sequence", "pageLayout"];

// ref を { entityType, entityId, stepId?, fieldPath? } に分ける。誤りは { error }
export function parseRef(ref) {
  const m = String(ref ?? "").trim().match(/^([A-Za-z]+):([^#@]+)(?:([#@])(.+))?$/);
  if (!m) return { error: `形が違います (<種類>:<ID>、<種類>:<ID>#<stepId>、<種類>:<ID>@$... のどれか)` };
  const [, entityType, entityId, sep, rest] = m;
  if (!ENTITY_TYPES.includes(entityType)) return { error: `種類 "${entityType}" は未知です (${ENTITY_TYPES.join(" / ")})` };
  const out = { entityType, entityId: entityId.trim() };
  if (sep === "#") {
    if (entityType !== "processFlow") return { error: "#<stepId> は processFlow だけで使えます" };
    if (rest.includes("@")) return { error: "#<stepId> と @<fieldPath> は同時に使えません" };
    out.stepId = rest;
  } else if (sep === "@") {
    if (!rest.startsWith("$")) return { error: "@ のあとの fieldPath は $ で始めてください (例: $.columns[col-02])" };
    out.fieldPath = rest;
  }
  return out;
}

const walkBlocks = (doc, f) => { const go = (bs) => { for (const b of bs || []) { f(b); if (b?.type === "details") go(b.blocks); } }; for (const s of doc?.sections || []) go(s?.blocks); };

// doc (vN.json) と answers (vN.answer.json) から、add_marker の引数の配列を作る
export function toMarkers(doc, answers) {
  const markers = []; const skipped = []; const errors = [];
  const topic = answers.topic ?? doc?.topic; const version = answers.version ?? doc?.version;
  const blocks = new Map(); walkBlocks(doc, (b) => { if (b?.id) blocks.set(b.id, b); });
  const emit = (label, ref, kind, author, lines) => {
    const r = parseRef(ref);
    if (r.error) { errors.push(`${label} ref "${ref}": ${r.error}`); return; }
    markers.push({ ...r, kind, author, body: lines.filter((x) => x != null && x !== "").join("\n") });
  };
  for (const q of answers.questions || []) {
    const b = blocks.get(q.id); const label = `Q${q.n ?? "?"} (${q.id})`; const tag = (id) => `[html-qa ${topic} v${version} ${id}]`;
    const qref = q.ref ?? b?.ref; const note = q.note?.trim() ? `補足: ${q.note.trim()}` : null;
    if (q.type === "review") {
      const judged = (q.items || []).filter((it) => it.judgement);
      for (const it of judged) {
        const ref = it.ref ?? b?.items?.find((x) => x.id === it.id)?.ref ?? qref;
        const lab = `Q${q.n ?? "?"}/${it.id}`;
        if (!ref) { skipped.push(`${lab} (${q.id}/${it.id})`); continue; }
        const word = { ok: "採用", ng: "不採用", hold: "保留" }[it.judgement];
        if (!word) { errors.push(`${lab}: judgement "${it.judgement}" は未知です`); continue; }
        emit(lab, ref, it.judgement === "hold" ? "question" : "todo", it.judgement === "hold" ? "ai" : "human", [tag(`${q.id}/${it.id}`), q.q, `${word}: ${it.title || it.id}`, it.note?.trim() ? `コメント: ${it.note.trim()}` : null]);
      }
      if (judged.length) continue;
    }
    if (q.state === "open" || !q.state) continue;
    if (!qref) { skipped.push(label); continue; }
    const rec = q.recommended?.length ? ` (推奨: ${q.recommended.join("・")})` : "";
    if (q.state === "answered") emit(label, qref, "todo", "human", [tag(q.id), q.q, `回答: ${q.answer}`, note]);
    else if (q.state === "delegate") emit(label, qref, "todo", "human", [tag(q.id), q.q, `おまかせ${rec}`, note]);
    else if (q.state === "defer") emit(label, qref, "question", "ai", [tag(q.id), q.q, "保留 (利用者があとで答えると選んだ質問。もう一度聞いてください)", note]);
    else errors.push(`${label}: state "${q.state}" は未知です`);
  }
  return { markers, skipped, errors };
}

function latestAnswerVersion(dir) {
  const vs = fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.answer\.json$/)).filter(Boolean).map((m) => Number(m[1]));
  return vs.length ? Math.max(...vs) : null;
}

export function main(argv) {
  const HELP = "使い方: node scripts/dev/html-qa-markers.mjs <議題フォルダ> [--version N]\n  html-qa の回答 (vN.answer.json) を designer__add_marker の引数の JSON 配列にして標準出力へ出す。\n  ref の形: <種類>:<ID> / processFlow:<ID>#<stepId> / <種類>:<ID>@$.<fieldPath>\n  種類: " + ENTITY_TYPES.join(" / ");
  if (argv.includes("--help") || argv.includes("-h")) { console.log(HELP); return 0; }
  const vi = argv.indexOf("--version");
  const dirArg = argv.find((a, i) => !a.startsWith("--") && !(vi >= 0 && i === vi + 1));
  if (!dirArg || !fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) { console.error(HELP); return 2; }
  const dir = path.resolve(dirArg);
  const version = vi >= 0 ? Number(argv[vi + 1]) : latestAnswerVersion(dir);
  const ansFile = version ? path.join(dir, `v${version}.answer.json`) : null;
  if (!ansFile || !fs.existsSync(ansFile)) { console.error(`AI に送る で送った回答 (v${version ?? "N"}.answer.json) がありません。返答をコピーした回答は取り込めません`); return 2; }
  let answers, doc;
  try { answers = JSON.parse(fs.readFileSync(ansFile, "utf8")); } catch (e) { console.error(`${ansFile} を読めません: ${e.message}`); return 2; }
  try { doc = JSON.parse(fs.readFileSync(path.join(dir, `v${version}.json`), "utf8")); } catch { doc = null; }
  const { markers, skipped, errors } = toMarkers(doc, answers);
  for (const s of skipped) console.error(`ref が無いので飛ばした: ${s}`);
  if (errors.length) { for (const m of errors) console.error(`✗ ${m}`); return 1; }
  console.log(JSON.stringify(markers, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
