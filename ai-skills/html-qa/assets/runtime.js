// html-qa runtime: 埋め込まれた議題 JSON を描画し、回答を集めて AI への返答文を作る。
// 外部依存なし。回答はこの閲覧者のブラウザ (localStorage) にだけ残る。
(() => {
  "use strict";
  const DOC = JSON.parse(document.getElementById("qa-doc").textContent);
  const META = JSON.parse(document.getElementById("qa-meta").textContent);
  const KEY = `html-qa:${DOC.topic}:v${DOC.version}`;
  const HKEY = `html-qa:${DOC.topic}:history`;
  const PKEY = "html-qa:prefs";
  const OTHER = "__other";

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境でも動かす */ } },
  };
  let A = store.get(KEY, {}); // { [qid]: { v, other, note, st, items, notes, touched } , _global, _autoRec }
  const prefs = store.get(PKEY, { zoom: 1, theme: "" });

  // ---------- 小道具 ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function inline(s) {
    const codes = [];
    let t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => /^(https?:|\.{0,2}\/|#|[\w-]+\.html)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${txt}</a>` : txt);
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  }
  // 段落・箇条書き・見出し (###) だけの小さな Markdown
  function md(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    const out = []; let para = []; let list = null;
    const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const line of lines) {
      let m;
      if (!line.trim()) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{3,4})\s+(.*)$/))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      if ((m = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/))) {
        flushP(); const tag = /\d/.test(m[1]) ? "ol" : "ul";
        if (!list || list.tag !== tag) { flushL(); list = { tag, items: [] }; }
        list.items.push(m[2]); continue;
      }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return out.join("");
  }
  const add = (el, ...kids) => { for (const c of kids.flat()) if (c != null && c !== false) el.append(c); return el; };
  const mdEl = (src, cls = "") => h("div", { class: `md ${cls}`, html: md(src) });
  const norm = (o, i) => (typeof o === "string" ? { value: o, label: o } : { ...o, value: o.value ?? o.label ?? String(i) });
  const save = () => store.set(KEY, A);
  const ans = (id) => (A[id] ||= {});

  // ---------- 設問の登録 ----------
  const QTYPES = new Set(["choice", "multi", "input", "scale", "rank", "review"]);
  const QS = []; // { id, b, n, sec }
  DOC.sections.forEach((s, si) => (s.blocks || []).forEach((b) => { if (QTYPES.has(b.type)) QS.push({ id: b.id, b, n: QS.length + 1, sec: si }); }));

  function isAnswered(q) {
    const a = A[q.id]; const b = q.b; if (!a) return false;
    switch (b.type) {
      case "choice": return a.v != null && a.v !== "" && (a.v !== OTHER || !!a.other?.trim());
      case "multi": return Array.isArray(a.v) && a.v.length > 0;
      case "input": return !!a.v?.trim();
      case "scale": return typeof a.v === "number";
      case "rank": return !!a.touched;
      case "review": return b.items.some((it) => a.items?.[it.id]);
    }
    return false;
  }
  function stateOf(q) {
    const a = A[q.id] || {};
    if (a.st === "defer") return "defer";
    if (a.st === "delegate") return "delegate";
    if (isAnswered(q)) return "done";
    if (A._autoRec && recommended(q.b)) return "delegate";
    return "";
  }
  const recommended = (b) => (b.options || []).map(norm).filter((o) => o.recommended);

  // ---------- 表示ブロック ----------
  function figureZoom(el) { el.addEventListener("click", () => openLightbox(el)); return el; }
  function codeBlock(b) {
    const pre = h("pre", { class: "code" });
    const lines = String(b.code ?? "").replace(/\n$/, "").split("\n");
    if (b.lang === "diff") pre.innerHTML = lines.map((l) => `<span class="${l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}">${esc(l) || " "}</span>`).join(b.lang === "diff" ? "" : "\n");
    else pre.textContent = lines.join("\n");
    return pre;
  }
  const RENDER = {
    text: (b) => mdEl(b.md),
    note: (b) => h("div", { class: `note ${b.kind || "info"}` }, b.title && h("div", { class: "t" }, b.title), mdEl(b.md)),
    table: (b) => {
      const hl = new Set((b.highlight || []).map(String));
      return h("div", null,
        h("div", { class: "tablewrap" }, h("table", null,
          b.columns && h("thead", null, h("tr", null, b.columns.map((c) => h("th", { html: inline(c) })))),
          h("tbody", null, (b.rows || []).map((r, ri) => h("tr", null, r.map((c, ci) => h("td", { class: hl.has(`${ri},${ci}`) || hl.has(`${ri}`) ? "hl" : null, html: inline(c) }))))))),
        b.caption && h("div", { class: "caption" }, b.caption));
    },
    code: (b) => h("div", null, codeBlock(b), b.caption && h("div", { class: "caption" }, b.caption)),
    image: (b) => h("div", { class: "figure" }, figureZoom(h("img", { src: b.src, alt: b.alt || b.caption || "" })), b.caption && h("div", { class: "caption" }, b.caption)),
    svg: (b) => h("div", { class: "figure" }, figureZoom(h("div", { class: "svgbox", html: b.svg })), b.caption && h("div", { class: "caption" }, b.caption)),
    html: (b) => h("div", { html: b.html }),
    compare: (b) => h("div", { class: "grid" }, b.options.map((o) => h("div", { class: `card ${o.recommended ? "rec" : ""}` },
      h("h4", null, o.title, o.recommended && h("span", { class: "tag" }, "推奨"), o.tag && h("span", { class: "tag warn" }, o.tag)),
      o.md && mdEl(o.md),
      o.pros?.length && h("ul", { class: "pc pros" }, o.pros.map((p) => h("li", { html: inline(p) }))),
      o.cons?.length && h("ul", { class: "pc cons" }, o.cons.map((p) => h("li", { html: inline(p) })))))),
    steps: (b) => h("div", { class: "steps" }, b.items.flatMap((it, i) => {
      const it2 = typeof it === "string" ? { title: it } : it;
      const card = h("div", { class: "step" }, h("div", { class: "n" }, `STEP ${i + 1}`), h("div", { class: "t" }, it2.title), it2.md && mdEl(it2.md, "muted"));
      return i ? [h("div", { class: "arrow", "aria-hidden": "true" }, "→"), card] : [card];
    })),
    kv: (b) => h("dl", { class: "kv" }, b.items.flatMap(([k, v]) => [h("dt", null, k), h("dd", { html: inline(v) })])),
    metrics: (b) => h("div", { class: "metrics" }, b.items.map((m) => h("div", { class: "metric" }, h("div", { class: "l" }, m.label), h("div", { class: "v" }, m.value), m.note && h("div", { class: "s" }, m.note)))),
    bars: (b) => {
      const max = b.max ?? Math.max(...b.items.map((i) => Number(i.value) || 0), 1);
      return h("div", { class: "bars" }, b.title && h("div", { class: "t" }, h("b", null, b.title)), b.items.map((i) => h("div", { class: "barrow" },
        h("div", null, i.label), h("div", { class: "bartrack" }, h("div", { class: "barfill", style: `width:${Math.max(0, Math.min(100, (Number(i.value) / max) * 100))}%` })),
        h("div", { class: "mono" }, `${i.value}${b.unit || ""}`))));
    },
    details: (b) => h("details", { class: "fold", open: b.open || null }, h("summary", null, b.title), b.md && mdEl(b.md), (b.blocks || []).map(renderBlock)),
  };

  // ---------- 設問ブロック ----------
  function qShell(q, body) {
    const b = q.b; const a = ans(q.id);
    const wrap = h("div", { class: "q", id: `q-${q.id}` });
    const noteBox = h("textarea", { rows: 2, placeholder: "補足・条件・理由など (任意)", oninput: (e) => { ans(q.id).note = e.target.value; changed(q); } });
    noteBox.value = a.note || "";
    const noteWrap = h("div", { class: "qnote", hidden: !a.note || null }, noteBox);
    const stBtn = (st, label, title) => h("button", { class: "btn small", "aria-pressed": String(a.st === st), title, onclick: (e) => {
      const cur = ans(q.id); cur.st = cur.st === st ? "" : st; changed(q);
      for (const x of e.target.parentElement.querySelectorAll("[data-st]")) x.setAttribute("aria-pressed", String(cur.st === x.dataset.st));
    }, "data-st": st }, label);
    const rec = recommended(b);
    add(wrap,
      h("div", { class: "qh" }, h("span", { class: "qn" }, `Q${q.n}`), h("span", { class: "qt" }, b.q), b.required && h("span", { class: "req" }, "必須")),
      b.md && mdEl(b.md, "qmd"),
      body,
      h("div", { class: "qfoot" },
        h("button", { class: "btn small", onclick: () => { noteWrap.hidden = !noteWrap.hidden; if (!noteWrap.hidden) noteBox.focus(); } }, "補足を書く"),
        h("span", { class: "sp" }),
        rec.length ? stBtn("delegate", `おまかせ (推奨: ${rec.map((o) => o.label).join("・")})`, "AI の推奨どおりに進めてもらう") : stBtn("delegate", "おまかせ", "AI の判断に任せる"),
        stBtn("defer", "あとで答える", "次の版でもう一度聞いてもらう")),
      noteWrap);
    q.el = wrap; paint(q);
    return wrap;
  }
  function optionList(q, multi) {
    const b = q.b; const opts = b.options.map(norm); const a = ans(q.id);
    const name = `o-${q.id}`;
    const other = h("input", { type: "text", class: "other", placeholder: "その他の内容", oninput: (e) => { ans(q.id).other = e.target.value; changed(q); } });
    other.value = a.other || "";
    const sel = () => (multi ? (Array.isArray(ans(q.id).v) ? ans(q.id).v : []) : ans(q.id).v);
    const rows = [...opts, ...(b.allowOther === false ? [] : [{ value: OTHER, label: "その他 (自由記述)" }])].map((o) => {
      const input = h("input", { type: multi ? "checkbox" : "radio", name, value: o.value });
      const cur = sel(); input.checked = multi ? cur.includes(o.value) : cur === o.value;
      const row = h("label", { class: `opt ${input.checked ? "on" : ""}` }, input,
        h("div", null, h("div", { class: "ol" }, o.label, o.recommended && h("span", { class: "tag", style: "margin-left:6px" }, "推奨")), o.md && mdEl(o.md, "od")));
      input.addEventListener("change", () => {
        const x = ans(q.id);
        if (multi) { const set = new Set(sel()); input.checked ? set.add(o.value) : set.delete(o.value); x.v = opts.map((p) => p.value).concat(OTHER).filter((v) => set.has(v)); }
        else x.v = o.value;
        for (const r of row.parentElement.children) r.classList.toggle("on", r.querySelector("input").checked);
        other.hidden = !(multi ? x.v.includes(OTHER) : x.v === OTHER);
        if (!other.hidden) other.focus();
        changed(q);
      });
      return row;
    });
    other.hidden = !(multi ? sel().includes(OTHER) : sel() === OTHER);
    return h("div", null, h("div", { class: "opts" }, rows), other);
  }
  const QRENDER = {
    choice: (q) => qShell(q, optionList(q, false)),
    multi: (q) => qShell(q, optionList(q, true)),
    input: (q) => {
      const t = h("textarea", { rows: q.b.lines || 3, placeholder: q.b.placeholder || "", oninput: (e) => { ans(q.id).v = e.target.value; changed(q); } });
      t.value = ans(q.id).v || "";
      return qShell(q, t);
    },
    scale: (q) => {
      const b = q.b; const a = ans(q.id);
      const min = b.min ?? 0, max = b.max ?? 10, step = b.step ?? 1;
      const val = h("div", { class: "sv mono" });
      const r = h("input", { type: "range", min, max, step });
      const show = () => { const v = ans(q.id).v; val.textContent = typeof v === "number" ? `${v}${b.unit || ""}` : "未回答"; };
      r.value = typeof a.v === "number" ? a.v : b.default ?? (min + max) / 2;
      r.addEventListener("input", () => { ans(q.id).v = Number(r.value); show(); changed(q); });
      show();
      return qShell(q, h("div", { class: "scale" }, r, val, (b.minLabel || b.maxLabel) && h("div", { class: "ends" }, h("span", null, b.minLabel || ""), h("span", null, b.maxLabel || ""))));
    },
    rank: (q) => {
      const items = q.b.items.map(norm);
      const order = () => { const v = ans(q.id).v; const ok = Array.isArray(v) && v.length === items.length && items.every((i) => v.includes(i.value)); return ok ? v : items.map((i) => i.value); };
      const ol = h("ol", { class: "rank" });
      let dragFrom = -1;
      const move = (from, to) => { const o = [...order()]; const [x] = o.splice(from, 1); o.splice(to, 0, x); const a = ans(q.id); a.v = o; a.touched = true; draw(); changed(q); };
      const draw = () => {
        ol.replaceChildren(...order().map((v, i) => {
          const it = items.find((x) => x.value === v);
          const li = h("li", { draggable: "true" }, h("span", { class: "rn" }, i + 1), h("span", { class: "rl" }, it.label),
            h("button", { class: "btn small", "aria-label": "上へ", disabled: i === 0 || null, onclick: () => move(i, i - 1) }, "↑"),
            h("button", { class: "btn small", "aria-label": "下へ", disabled: i === items.length - 1 || null, onclick: () => move(i, i + 1) }, "↓"));
          li.addEventListener("dragstart", () => { dragFrom = i; li.classList.add("drag"); });
          li.addEventListener("dragend", () => li.classList.remove("drag"));
          li.addEventListener("dragover", (e) => e.preventDefault());
          li.addEventListener("drop", (e) => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i); dragFrom = -1; });
          return li;
        }));
      };
      draw();
      return qShell(q, h("div", null, ol, h("div", { class: "caption" }, "ドラッグか ↑↓ で並べ替えると回答になります。このままで良ければ「この順で良い」。"),
        h("button", { class: "btn small", style: "margin-top:6px", onclick: () => { ans(q.id).touched = true; ans(q.id).v = order(); changed(q); } }, "この順で良い")));
    },
    review: (q) => {
      const b = q.b;
      const list = h("div", { class: "rv" }, b.items.map((it) => {
        const a = ans(q.id); a.items ||= {}; a.notes ||= {};
        const box = h("div", { class: `rvitem ${a.items[it.id] || ""}` });
        const seg = h("span", { class: "seg" }, [["ok", "採用"], ["ng", "不採用"], ["hold", "保留"]].map(([k, l]) => h("button", { class: `${k} ${a.items[it.id] === k ? "on" : ""}`, onclick: () => {
          const x = ans(q.id); x.items[it.id] = x.items[it.id] === k ? undefined : k;
          box.className = `rvitem ${x.items[it.id] || ""}`;
          for (const btn of seg.children) btn.classList.toggle("on", btn.classList.contains(x.items[it.id]));
          changed(q);
        } }, l)));
        const note = h("input", { type: "text", placeholder: "コメント (任意)", style: "margin-top:6px", oninput: (e) => { ans(q.id).notes[it.id] = e.target.value; changed(q); } });
        note.value = a.notes[it.id] || "";
        add(box, h("div", { class: "rvh" }, h("span", { class: "rvt" }, it.title || it.id), it.ref && h("span", { class: "ref mono" }, it.ref), seg), it.md && mdEl(it.md), note);
        return box;
      }));
      return qShell(q, list);
    },
  };

  function renderBlock(b) {
    const q = QS.find((x) => x.b === b);
    const el = q ? QRENDER[b.type](q) : RENDER[b.type] ? RENDER[b.type](b) : h("div", { class: "note warn" }, `未対応のブロック: ${b.type}`);
    return h("div", { class: "block" }, el);
  }

  // ---------- 状態の反映 ----------
  function paint(q) {
    const st = stateOf(q);
    if (q.el) q.el.className = `q ${st}`;
    const dot = document.querySelector(`[data-dot="${CSS.escape(q.id)}"]`);
    if (dot) dot.className = `dot ${st}`;
  }
  let dirty = false;
  function changed(q) { if (q) paint(q); save(); refresh(); }
  function refresh() {
    const n = (st) => QS.filter((q) => stateOf(q) === st).length;
    const done = n("done"), left = QS.length - done - n("defer") - n("delegate");
    const extra = [n("delegate") && `おまかせ ${n("delegate")}`, n("defer") && `あとで ${n("defer")}`, `残り ${left}`].filter(Boolean).join(" · ");
    progress.innerHTML = `回答 <b>${done}</b> / ${QS.length} <span class="muted">(${extra})</span>`;
    dockCount.textContent = `回答 ${done} / ${QS.length} · ${extra}`;
    if (!dirty) promptBox.value = buildPrompt();
    else dirtyNote.hidden = false;
  }

  // ---------- 返答文 ----------
  function fmtAnswer(q) {
    const b = q.b; const a = A[q.id] || {};
    const opts = (b.options || b.items || []).map(norm);
    const lab = (v) => (v === OTHER ? `その他: ${a.other?.trim() || "(未記入)"}` : opts.find((o) => o.value === v)?.label ?? v);
    switch (b.type) {
      case "choice": return `回答: ${lab(a.v)}`;
      case "multi": return `回答: ${a.v.map(lab).join("、")}`;
      case "input": return `回答:\n${a.v.trim()}`;
      case "scale": return `回答: ${a.v}${b.unit || ""}`;
      case "rank": return `回答 (優先順):\n${a.v.map((v, i) => `${i + 1}. ${lab(v)}`).join("\n")}`;
      case "review": {
        const lines = b.items.map((it) => {
          const s = { ok: "採用", ng: "不採用", hold: "保留" }[a.items?.[it.id]] || "未判断";
          const n = a.notes?.[it.id]?.trim();
          return `- [${s}] ${it.title || it.id} (id: ${it.id})${n ? ` — ${n}` : ""}`;
        });
        return `回答:\n${lines.join("\n")}`;
      }
    }
    return "";
  }
  function buildPrompt() {
    const answered = [], deferred = [], delegated = [], open = [];
    for (const q of QS) {
      const st = stateOf(q);
      if (st === "defer") deferred.push(q); else if (st === "delegate") delegated.push(q);
      else if (isAnswered(q)) answered.push(q); else open.push(q);
    }
    const head = (q) => `Q${q.n}. ${q.b.q} (id: ${q.id})`;
    const out = [`[html-qa の回答] ${DOC.title}`, `topic: ${DOC.topic} / v${DOC.version}${META.jsonPath ? ` / 資料: ${META.jsonPath}` : ""}`, `回答 ${answered.length} / 全 ${QS.length} 問`];
    for (const q of answered) {
      out.push("", `■ ${head(q)}`, fmtAnswer(q));
      const n = A[q.id]?.note?.trim(); if (n) out.push(`補足: ${n}`);
    }
    if (delegated.length) {
      out.push("", "■ おまかせ — AI の推奨・判断で進めてください");
      for (const q of delegated) { const r = recommended(q.b); const n = A[q.id]?.note?.trim(); out.push(`- ${head(q)}${r.length ? ` → 推奨: ${r.map((o) => o.label).join("・")}` : ""}${n ? ` / 補足: ${n}` : ""}`); }
    }
    if (deferred.length) {
      out.push("", "■ 保留 — 次の版でもう一度聞いてください");
      for (const q of deferred) { const n = A[q.id]?.note?.trim(); out.push(`- ${head(q)}${n ? ` / メモ: ${n}` : ""}`); }
    }
    if (open.length) {
      out.push("", "■ 未回答 — 必要なら次の版で聞き直してください");
      for (const q of open) out.push(`- ${head(q)}${q.b.required ? " ※必須" : ""}`);
    }
    if (A._global?.trim()) out.push("", "■ 全体へのコメント", A._global.trim());
    return out.join("\n");
  }

  // ---------- 画面 ----------
  const root = document.documentElement;
  const applyPrefs = () => {
    root.style.setProperty("--zoom", String(prefs.zoom || 1));
    if (prefs.theme) root.dataset.theme = prefs.theme; else delete root.dataset.theme;
    zoomLabel.textContent = `${Math.round((prefs.zoom || 1) * 100)}%`;
  };
  const zoomBy = (d) => { prefs.zoom = Math.max(0.7, Math.min(1.8, Math.round(((prefs.zoom || 1) + d) * 10) / 10)); store.set(PKEY, prefs); applyPrefs(); };
  const zoomLabel = h("span", { class: "progress mono" });
  const progress = h("span", { class: "progress" });
  const versions = META.versions || [];
  const verSel = versions.length > 1 ? h("select", { class: "btn", "aria-label": "版", onchange: (e) => { location.href = e.target.value; } },
    versions.map((v) => h("option", { value: v.file, selected: v.version === DOC.version || null }, `v${v.version}${v.version === META.latest ? " (最新)" : ""}`))) : null;

  document.title = `${DOC.title} — v${DOC.version}`;
  const bar = h("header", { class: "bar" },
    h("h1", { title: DOC.title }, DOC.title), h("span", { class: "badge" }, `v${DOC.version}`), verSel, progress,
    h("div", { class: "tools" },
      h("button", { class: "btn", title: "縮小", onclick: () => zoomBy(-0.1) }, "A−"), zoomLabel, h("button", { class: "btn", title: "拡大", onclick: () => zoomBy(0.1) }, "A＋"),
      h("button", { class: "btn", title: "テーマ切替", onclick: () => { const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; prefs.theme = dark ? "light" : "dark"; store.set(PKEY, prefs); applyPrefs(); } }, "◐"),
      h("button", { class: "btn", onclick: () => openHistory() }, "過去の返答"),
      h("button", { class: "btn", onclick: () => print() }, "印刷"),
      META.indexHref && h("a", { class: "btn", href: META.indexHref, style: "text-decoration:none" }, "議題一覧")));

  const toc = h("nav", { class: "toc", "aria-label": "目次" });
  const main = h("main");
  if (META.latest > DOC.version) main.append(h("div", { class: "banner" }, `この版は古い版です。`, h("a", { href: (versions.find((v) => v.version === META.latest) || {}).file || "index.html" }, `最新の v${META.latest} を開く`)));
  const liveBanner = h("div", { class: "banner", hidden: true });
  main.append(liveBanner);
  if (DOC.lead) main.append(h("div", { class: "lead md", html: md(DOC.lead) }));

  if (DOC.decisions?.length) {
    main.append(h("section", { class: "sec", id: "sec-decisions" }, h("h2", null, "これまでに決まったこと"),
      h("div", { class: "card decisions" }, DOC.decisions.map((d) => h("div", { class: "dec" }, h("span", { class: "dv" }, d.since ? `v${d.since}` : ""), h("div", null, h("b", null, d.title), d.md && mdEl(d.md, "muted")))))));
    toc.append(h("a", { class: "sec", href: "#sec-decisions" }, "これまでに決まったこと"));
  }
  DOC.sections.forEach((s, si) => {
    const id = `sec-${si + 1}`;
    main.append(h("section", { class: "sec", id }, h("h2", null, s.title), (s.blocks || []).map(renderBlock)));
    toc.append(h("a", { class: "sec", href: `#${id}` }, s.title));
    for (const q of QS.filter((x) => x.sec === si)) toc.append(h("a", { href: `#q-${q.id}` }, h("span", { "data-dot": q.id, class: "dot" }), `Q${q.n} ${q.b.q}`));
  });
  const globalBox = h("textarea", { rows: 3, placeholder: "質問以外に伝えたいこと (任意)", oninput: (e) => { A._global = e.target.value; changed(); } });
  globalBox.value = A._global || "";
  const autoRec = h("input", { type: "checkbox", onchange: (e) => { A._autoRec = e.target.checked; QS.forEach(paint); changed(); } });
  autoRec.checked = !!A._autoRec;
  add(main, h("section", { class: "sec", id: "sec-global" }, h("h2", null, "全体へのコメント"), globalBox,
    QS.some((q) => recommended(q.b).length) && h("div", { style: "margin-top:8px" }, h("label", { class: "chk" }, autoRec, "答えていない質問は、推奨がある場合は推奨どおりで良い"))));
  toc.append(h("a", { class: "sec", href: "#sec-global" }, "全体へのコメント"));

  // ---------- 返答のドック ----------
  const promptBox = h("textarea", { "aria-label": "AI への返答", oninput: () => { dirty = true; } });
  const dirtyNote = h("span", { class: "dirty", hidden: true }, "手で直した内容があります。回答の変更は反映されていません。",
    h("button", { class: "btn small", style: "margin-left:6px", onclick: () => { dirty = false; dirtyNote.hidden = true; refresh(); } }, "作り直す"));
  const msg = h("span", { class: "msg", role: "status", "aria-live": "polite" });
  const say = (t, err) => { msg.textContent = t; msg.className = `msg ${err ? "err" : ""}`; clearTimeout(say.t); say.t = setTimeout(() => { msg.textContent = ""; }, 6000); };
  const dockCount = h("span", { class: "progress" });
  const dock = h("footer", { class: "dock" });
  const pushHistory = (text, via) => {
    const hist = store.get(HKEY, []);
    if (hist[0]?.text === text) return;
    hist.unshift({ at: new Date().toISOString(), version: DOC.version, via, text });
    store.set(HKEY, hist.slice(0, 50));
  };
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 下で代替 */ }
    const t = h("textarea", { style: "position:fixed;opacity:0" }); t.value = text; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove(); return ok;
  }
  const doCopy = async () => {
    const text = promptBox.value;
    if (await copyText(text)) { pushHistory(text, "copy"); say("コピーしました。AI のチャットに貼り付けてください"); }
    else { promptBox.focus(); promptBox.select(); say("コピーできませんでした。選択された文を手でコピーしてください", true); }
  };
  // サーバ経由のときの状態: AI が待ち受け中か / 送った回答を AI が読んだか
  const live = { served: false, waiting: false, sent: false, seen: false };
  const aiState = h("span", { class: "aistate", hidden: true, role: "status" });
  const paintAi = () => {
    aiState.hidden = !live.served;
    const [cls, text] = live.sent && live.seen ? ["ok", "AI が受け取りました ✓"]
      : live.sent ? ["wait", live.waiting ? "AI に届けています…" : "送りました。チャットで何か一言 (例:「続けて」) 送ると AI に届きます"]
      : live.waiting ? ["on", "AI が回答を待っています"] : ["off", "AI は待ち受けていません (送った回答は、次にチャットで発言したときに届きます)"];
    aiState.className = `aistate ${cls}`; aiState.textContent = text;
  };
  const doSend = async () => {
    const text = promptBox.value;
    try {
      const r = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: DOC.topic, version: DOC.version, text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      pushHistory(text, "file");
      live.sent = true; live.seen = false; paintAi();
      say(live.waiting ? "送りました。AI が自動で続きを始めます" : `送りました (${j.path})`);
      pollStatus();
    } catch (e) { say(`送れませんでした: ${e.message}`, true); }
  };
  const saveBtn = h("button", { class: "btn", hidden: true, title: "回答をファイルに書き、AI に届けます (Ctrl+Enter)", onclick: doSend }, "AI に送る");
  const copyBtn = h("button", { class: "btn primary", title: "Ctrl+Enter", onclick: doCopy }, "返答をコピー");
  const toggleDock = (open) => { dock.classList.toggle("open", open ?? !dock.classList.contains("open")); openBtn.textContent = dock.classList.contains("open") ? "閉じる ▼" : "返答を作る ▲"; };
  const openBtn = h("button", { class: "btn", onclick: () => toggleDock() }, "返答を作る ▲");
  dock.append(
    h("div", { class: "row" }, dockCount, h("span", { class: "sp" }), msg,
      h("button", { class: "btn", onclick: () => { if (confirm("この版の回答をすべて消します。よろしいですか?")) { A = {}; save(); location.reload(); } } }, "回答を消す"),
      openBtn, copyBtn, saveBtn),
    h("div", { class: "row airow" }, aiState),
    h("div", { class: "body" }, h("div", { style: "margin-bottom:6px" }, dirtyNote), promptBox));

  // ---------- 過去の返答 ----------
  const histOverlay = h("div", { class: "overlay", onclick: (e) => { if (e.target === histOverlay) histOverlay.classList.remove("open"); } });
  function openHistory() {
    const hist = store.get(HKEY, []);
    const panel = h("div", { class: "panel", role: "dialog", "aria-label": "過去の返答" },
      h("h3", null, "過去の返答 (このブラウザに保存)", h("span", { class: "sp" }), h("button", { class: "btn", onclick: () => histOverlay.classList.remove("open") }, "閉じる")),
      hist.length ? hist.map((x, i) => h("div", { class: "hist" },
        h("div", { class: "hh" }, h("span", { class: "badge" }, `v${x.version}`), new Date(x.at).toLocaleString(), h("span", { class: "muted" }, x.via === "file" ? "AI に送った" : "コピー"), h("span", { class: "sp" }),
          h("button", { class: "btn small", onclick: async () => say((await copyText(x.text)) ? "コピーしました" : "コピーできませんでした", false) }, "コピー"),
          h("button", { class: "btn small", onclick: () => { const all = store.get(HKEY, []); all.splice(i, 1); store.set(HKEY, all); openHistory(); } }, "削除")),
        h("pre", null, x.text))) : h("p", { class: "muted" }, "まだありません。「返答をコピー」か「AI に送る」をすると、ここに残ります。"));
    histOverlay.replaceChildren(panel); histOverlay.classList.add("open");
  }

  // ---------- 図の拡大 ----------
  const lb = h("div", { class: "overlay lightbox", onclick: (e) => { if (e.target === lb) lb.classList.remove("open"); } });
  function openLightbox(src) {
    let scale = 1;
    const node = src.cloneNode(true); node.style.cursor = "default";
    const stage = h("div", { class: "stage" }, node);
    const set = (s) => { scale = Math.max(0.25, Math.min(6, s)); node.style.zoom = String(scale); };
    stage.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); set(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); } }, { passive: false });
    lb.replaceChildren(stage, h("div", { class: "ctl" },
      h("button", { class: "btn", onclick: () => set(scale / 1.25) }, "−"), h("button", { class: "btn", onclick: () => set(1) }, "100%"),
      h("button", { class: "btn", onclick: () => set(scale * 1.25) }, "＋"), h("button", { class: "btn", onclick: () => lb.classList.remove("open") }, "閉じる")));
    lb.classList.add("open");
  }
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { lb.classList.remove("open"); histOverlay.classList.remove("open"); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); live.served ? doSend() : doCopy(); }
  });

  document.body.append(bar, h("div", { class: "layout" }, toc, main), dock, histOverlay, lb);
  applyPrefs();
  QS.forEach(paint);
  refresh();

  // 前の版の回答を引き継ぐ (同じ id の質問だけ)
  const prevV = versions.filter((v) => v.version < DOC.version).map((v) => v.version).sort((a, b) => b - a)[0];
  const hasInput = (a) => !!a && Object.entries(a).some(([k, v]) => k !== "touched" && (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.values(v).some(Boolean) : v !== "" && v != null));
  if (prevV && !QS.some((q) => hasInput(A[q.id]))) {
    const prev = store.get(`html-qa:${DOC.topic}:v${prevV}`, {});
    const carry = QS.filter((q) => hasInput(prev[q.id]));
    if (carry.length) {
      const box = h("div", { class: "note tip block" }, `v${prevV} で同じ質問に入力した内容が ${carry.length} 件あります。`,
        h("button", { class: "btn small", style: "margin-left:8px", onclick: () => { for (const q of carry) A[q.id] = { ...prev[q.id], st: prev[q.id].st === "defer" ? "" : prev[q.id].st }; save(); location.reload(); } }, "引き継ぐ"));
      main.insertBefore(box, main.firstChild);
    }
  }

  // サーバ経由で開いているときは「AI に送る」・AI の状態・新しい版の通知を使う
  async function fetchStatus() {
    const r = await fetch(`/api/status?topic=${encodeURIComponent(DOC.topic)}&version=${DOC.version}`);
    if (!r.ok) return;
    const x = await r.json();
    live.waiting = x.waiting; live.seen = x.seen; live.sent = x.answered;
    paintAi();
  }
  let fast = null;
  function pollStatus() {
    clearInterval(fast);
    let n = 0;
    fast = setInterval(async () => { n++; try { await fetchStatus(); } catch { /* 続ける */ } if (live.seen || n > 150) clearInterval(fast); }, 1000);
  }
  if (location.protocol.startsWith("http")) {
    fetch("/api/ping").then((r) => r.ok && r.json()).then(async (j) => {
      if (!j?.ok) return;
      live.served = true;
      saveBtn.hidden = false; saveBtn.classList.add("primary"); copyBtn.classList.remove("primary");
      try { await fetchStatus(); } catch { /* 続ける */ }
      const poll = async () => {
        try {
          await fetchStatus();
          const r = await fetch(`/api/latest?topic=${encodeURIComponent(DOC.topic)}`); const x = await r.json();
          if (x.version > Math.max(DOC.version, META.latest || 0)) {
            // 送り終えた版なら、そのまま新しい版へ移る (入力はブラウザに残っている)
            if (live.sent && live.seen) { location.href = x.file; return; }
            liveBanner.hidden = false; liveBanner.replaceChildren(`新しい版 v${x.version} ができました。`, h("a", { href: x.file }, "開く")); return;
          }
        } catch { /* サーバが止まっていても続ける */ }
        setTimeout(poll, 3000);
      };
      poll();
    }).catch(() => {});
  }
})();
