/**
 * 画面項目の属性だけを、コピーして別の項目へ貼る操作 (UI 改善提案 第 3 弾 #54)。
 * 「属性をコピー」→ 別の項目 (複数でも) を選んで「属性を貼り付け…」→ 貼る属性を選ぶ。
 */
import { useState } from "react";
import type { ScreenItem } from "../../types/v3/screen-item";
import {
  ITEM_ATTRS, captureAttrs, defaultPasteKeys, describeAttr, setAttrClipboard, useAttrClipboard, type AttrKey, type AttrSnapshot,
} from "../../utils/itemAttrs";
import { showToast } from "../../utils/toast";

export interface AttrClipboardBarProps {
  editable: boolean;
  /** コピー元にできる項目 (1 つ選んでいるとき) */
  source?: ScreenItem;
  /** 貼り先の項目の数 (0 なら、貼り付けは出さない) */
  targetCount: number;
  /** keys の属性を、貼り先すべてに貼る */
  onPaste: (snapshot: AttrSnapshot, keys: AttrKey[]) => void;
}

export function AttrClipboardBar({ editable, source, targetCount, onPaste }: AttrClipboardBarProps) {
  const clip = useAttrClipboard();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<AttrKey[]>([]);

  const copy = () => {
    if (!source) return;
    const snapshot = captureAttrs(source);
    setAttrClipboard({ snapshot, sourceId: source.id as string, sourceLabel: (source.label as string) || (source.id as string) });
    showToast(`「${(source.label as string) || source.id}」の属性 ${Object.keys(snapshot).length} 件をコピーしました (別の項目を選んで「属性を貼り付け」)`, "info");
  };
  const toggleOpen = () => {
    if (!open && clip) setKeys(defaultPasteKeys(clip.snapshot));
    setOpen(!open);
  };
  const paste = () => {
    if (!clip || keys.length === 0) return;
    onPaste(clip.snapshot, keys);
    setOpen(false);
    showToast(`${targetCount} 項目へ、属性 ${keys.length} 件を貼り付けました`, "info");
  };

  return (
    <div className="sld-attr-bar" data-testid="layout-attr-bar">
      {source && (
        <button type="button" className="sld-btn" onClick={copy} title="この項目の入力の決まり (必須・桁・書式・選択肢など) をコピー。別の項目へ貼れます" data-testid="layout-attr-copy">
          <i className="bi bi-clipboard-plus" /> 属性をコピー
        </button>
      )}
      {clip && targetCount > 0 && (
        <button type="button" className="sld-btn" disabled={!editable} onClick={toggleOpen} aria-expanded={open} data-testid="layout-attr-paste-open"
          title={`「${clip.sourceLabel}」からコピーした属性を、${targetCount} 項目へ貼ります`}>
          <i className="bi bi-clipboard-check" /> 属性を貼り付け…
        </button>
      )}
      {open && clip && (
        <div className="sld-attr-pop" role="group" aria-label="貼り付ける属性" data-testid="layout-attr-pop">
          <div className="sld-attr-pop-title">「{clip.sourceLabel}」から、{targetCount} 項目へ</div>
          <ul>
            {ITEM_ATTRS.map((a) => {
              const has = clip.snapshot[a.key] !== undefined;
              return (
                <li key={a.key}>
                  <label>
                    <input type="checkbox" checked={keys.includes(a.key)} onChange={(e) => setKeys(e.target.checked ? [...keys, a.key] : keys.filter((k) => k !== a.key))} data-testid={`layout-attr-key-${a.key}`} />
                    {a.label}
                    <span className={has ? "sld-attr-val" : "sld-attr-val is-unset"}>{has ? describeAttr(a.key, clip.snapshot[a.key]) : "未設定 (貼り先も未設定にする)"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="sld-btn-row">
            <button type="button" className="sld-btn sld-btn-primary" disabled={keys.length === 0} onClick={paste} data-testid="layout-attr-paste">貼り付け ({keys.length})</button>
            <button type="button" className="sld-btn" onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

