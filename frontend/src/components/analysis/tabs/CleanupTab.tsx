/**
 * 整理。どこからも使われていない定義・用語の揺れ・メッセージの使用箇所と重複を一覧にして、整理を促す。
 * ここに出るのは候補で、消す・直すかどうかは設計者が決める (一覧は、読むだけで何も書き換えない)。
 */
import { useMemo, useState } from "react";
import { analyzeMessages, buildDesignGraph, findTermInconsistencies, findUnused, NODE_KIND_LABELS, type DesignDocInput, type NodeKind } from "@harmony/shared";
import { AnTable, EntityLink, Empty, Section } from "../ui";

type Sub = "unused" | "terms" | "messages";
const SUBS: Array<{ id: Sub; label: string }> = [{ id: "unused", label: "未使用の定義" }, { id: "terms", label: "用語の揺れ" }, { id: "messages", label: "メッセージ・文言" }];

export function CleanupTab({ input }: { input: DesignDocInput }) {
  const [sub, setSub] = useState<Sub>("unused");
  const graph = useMemo(() => buildDesignGraph(input), [input]);
  return (
    <div className="an-pane" data-testid="an-cleanup">
      <nav className="an-subtabs" aria-label="整理の種類">
        {SUBS.map((s) => <button key={s.id} type="button" className={sub === s.id ? "on" : ""} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>{s.label}</button>)}
      </nav>
      {sub === "unused" ? <Unused input={input} graph={graph} /> : sub === "terms" ? <Terms input={input} /> : <Messages input={input} graph={graph} />}
    </div>
  );
}

function Unused({ input, graph }: { input: DesignDocInput; graph: ReturnType<typeof buildDesignGraph> }) {
  const items = useMemo(() => findUnused(input, graph), [input, graph]);
  const groups = useMemo(() => {
    const m = new Map<NodeKind, typeof items>();
    for (const i of items) (m.get(i.kind) ?? m.set(i.kind, []).get(i.kind)!).push(i);
    return [...m.entries()];
  }, [items]);
  return (
    <Section title={`未使用の定義 (${items.length} 件)`} hint="どこからも参照されていないものです。入口の画面・外部から呼ぶ処理のように、使われていて当然のものが混じることもあります。" testId="an-unused">
      {groups.length === 0 ? <Empty>未使用の定義はありません。</Empty> : groups.map(([kind, list]) => (
        <div key={kind} className="an-level">
          <h3>{NODE_KIND_LABELS[kind]} ({list.length} 件)</h3>
          <AnTable testId={`an-unused-${kind}`} headers={["名前", "理由"]} rows={list.map((i) => [i.ref ? <EntityLink key="l" kind={i.ref.kind} id={i.ref.id}>{i.name}</EntityLink> : i.name, i.reason])} />
        </div>
      ))}
      <p className="an-hint">シーケンス・ビュー・ビュー定義・ページレイアウトから使われているかは見ていません (そこからだけ使われているものも、ここには出ます)。消す前に、参照元 (設計の「参照元」) で確かめてください。</p>
      <p className="an-hint">汎用定義は、参照の形が決まっている種類 (component-definition / exception-type / global) だけを対象にしています。</p>
    </Section>
  );
}

function Terms({ input }: { input: DesignDocInput }) {
  const issues = useMemo(() => findTermInconsistencies(input), [input]);
  const kinds = { "same-physical-different-display": "同じ物理名で、表示名が違う", "same-display-different-physical": "同じ表示名で、物理名が違う" } as const;
  return (
    <>
      {(Object.keys(kinds) as Array<keyof typeof kinds>).map((k) => {
        const list = issues.filter((i) => i.kind === k);
        return (
          <Section key={k} title={`${kinds[k]} (${list.length} 件)`} testId={`an-terms-${k}`}>
            <AnTable headers={[k === "same-physical-different-display" ? "物理名" : "表示名", "表記と使われている場所", "統一の候補"]} empty="揺れはありません。" rows={list.map((i) => [
              <code key="s">{i.subject}</code>,
              <ul key="v" className="an-list">{i.variants.map((v) => (
                <li key={v.text}><b>{v.text}</b>: {v.places.map((p, n) => <span key={n}>{n > 0 && "、"}{p.ref ? <EntityLink kind={p.ref.kind} id={p.ref.id}>{p.label}</EntityLink> : p.label}</span>)}</li>
              ))}</ul>,
              <b key="g">{i.suggestion}</b>,
            ])} />
          </Section>
        );
      })}
      <p className="an-hint">snake_case と camelCase は同じ名前として扱います。「id」「name」など、表の中で意味が変わる名前は、揺れとして扱いません。</p>
    </>
  );
}

function Messages({ input, graph }: { input: DesignDocInput; graph: ReturnType<typeof buildDesignGraph> }) {
  const a = useMemo(() => analyzeMessages(input, graph), [input, graph]);
  return (
    <>
      <Section title={`メッセージごとの使用箇所 (${a.messages.length} 件)`} testId="an-msg-usage">
        <AnTable headers={["メッセージ", "文面", "使用箇所"]} empty="規約カタログにメッセージがありません。" rows={a.messages.map((m) => [
          <code key="k">@conv.msg.{m.key}</code>, m.template,
          m.uses.length ? <span key="u">{m.uses.map((u, i) => <span key={`${u.kind}:${u.id}`}>{i > 0 && "、"}<EntityLink kind={u.kind} id={u.id}>{u.name}</EntityLink></span>)}</span> : <span key="u" className="an-warn">どこでも使われていません</span>,
        ])} />
      </Section>
      <Section title={`定義の無いメッセージの参照 (${a.undefinedRefs.length} 件)`} hint="本文が参照しているのに、規約カタログに無いメッセージです。" testId="an-msg-undefined">
        <AnTable headers={["メッセージ", "参照している設計"]} empty="定義の無い参照はありません。" rows={a.undefinedRefs.map((u) => [<code key="k">@conv.msg.{u.key}</code>, <span key="u">{u.uses.map((x, i) => <span key={`${x.kind}:${x.id}`}>{i > 0 && "、"}<EntityLink kind={x.kind} id={x.id}>{x.name}</EntityLink></span>)}</span>])} />
      </Section>
      <Section title={`重複・似た文面 (${a.similar.length} 組)`} hint="同じ文面は 1 つにまとめられます。似ている文面は、言い回しをそろえる候補です。" testId="an-msg-similar">
        <AnTable headers={["区分", "メッセージ", "文面"]} empty="重複・似た文面はありません。" rows={a.similar.map((s) => [
          s.reason === "same" ? "同じ文面" : `似ている (${Math.round(s.score * 100)}%)`,
          s.keys.map((k) => <code key={k}>@conv.msg.{k}</code>),
          <ul key="t" className="an-list">{s.keys.map((k) => <li key={k}>{a.messages.find((m) => m.key === k)?.template}</li>)}</ul>,
        ])} />
      </Section>
    </>
  );
}
