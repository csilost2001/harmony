import { useState, useEffect, useCallback } from "react";
import { useEditorMaybe } from "@grapesjs/react";
import type { Component } from "grapesjs";

// ── WCAG コントラスト計算 ────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── ARIA 属性サジェスト ────────────────────────────────────────────────────────

interface AriaAttr {
  attr: string;
  hint: string;
  defaultValue?: string;
}

const ARIA_BY_TAG: Record<string, AriaAttr[]> = {
  button: [
    { attr: "aria-label",    hint: "ボタンの説明（アイコンのみの場合に必須）" },
    { attr: "aria-pressed",  hint: "トグル状態", defaultValue: "false" },
    { attr: "aria-expanded", hint: "ドロップダウン等の展開状態", defaultValue: "false" },
    { attr: "aria-disabled", hint: "無効状態", defaultValue: "true" },
    { attr: "aria-haspopup", hint: "ポップアップあり", defaultValue: "true" },
  ],
  a: [
    { attr: "aria-label",   hint: "リンクの説明（テキストを補足）" },
    { attr: "aria-current", hint: "現在のページ/ステップ", defaultValue: "page" },
  ],
  input: [
    { attr: "aria-label",       hint: "入力欄の説明（label要素がない場合）" },
    { attr: "aria-required",    hint: "必須入力", defaultValue: "true" },
    { attr: "aria-invalid",     hint: "入力エラー", defaultValue: "true" },
    { attr: "aria-describedby", hint: "エラーメッセージ要素のID" },
    { attr: "aria-autocomplete", hint: "オートコンプリート", defaultValue: "list" },
  ],
  select: [
    { attr: "aria-label",    hint: "選択欄の説明" },
    { attr: "aria-required", hint: "必須選択", defaultValue: "true" },
    { attr: "aria-invalid",  hint: "選択エラー", defaultValue: "true" },
  ],
  textarea: [
    { attr: "aria-label",    hint: "テキストエリアの説明" },
    { attr: "aria-required", hint: "必須入力", defaultValue: "true" },
    { attr: "aria-invalid",  hint: "入力エラー", defaultValue: "true" },
  ],
  img: [
    { attr: "alt",         hint: "代替テキスト（必須）" },
    { attr: "aria-hidden", hint: "装飾画像として支援技術から除外", defaultValue: "true" },
  ],
  nav: [
    { attr: "aria-label", hint: "ナビゲーション領域の名前" },
  ],
  table: [
    { attr: "aria-label",   hint: "表の説明" },
    { attr: "role",         hint: "グリッド用途の場合", defaultValue: "grid" },
  ],
  th: [
    { attr: "scope", hint: "ヘッダーの適用範囲", defaultValue: "col" },
  ],
  form: [
    { attr: "aria-label",      hint: "フォームの名前" },
    { attr: "aria-labelledby", hint: "見出し要素のID" },
    { attr: "novalidate",      hint: "ブラウザのバリデーションを無効化", defaultValue: "" },
  ],
  dialog: [
    { attr: "role",           hint: "ダイアログとして明示", defaultValue: "dialog" },
    { attr: "aria-modal",     hint: "モーダルダイアログ", defaultValue: "true" },
    { attr: "aria-labelledby", hint: "タイトル要素のID" },
  ],
};

const GENERIC_ARIA: AriaAttr[] = [
  { attr: "role",            hint: "要素の役割を明示（landmark, widget等）" },
  { attr: "aria-label",      hint: "要素の説明" },
  { attr: "aria-labelledby", hint: "ラベル要素のID" },
  { attr: "aria-hidden",     hint: "支援技術から非表示", defaultValue: "true" },
  { attr: "aria-live",       hint: "動的コンテンツの通知", defaultValue: "polite" },
  { attr: "tabindex",        hint: "フォーカス順序", defaultValue: "0" },
];

// ── コンポーネント ────────────────────────────────────────────────────────────

export function A11yPanel() {
  const editor = useEditorMaybe();
  const [selected, setSelected] = useState<Component | null>(null);
  const [currentAttrs, setCurrentAttrs] = useState<Record<string, string>>({});
  const [addingAttr, setAddingAttr] = useState<string | null>(null);
  const [addValue, setAddValue] = useState("");

  // コントラストチェッカー
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");

  // コンポーネント選択追跡
  useEffect(() => {
    if (!editor) return;
    const onToggle = () => {
      const comp = editor.getSelected() ?? null;
      setSelected(comp);
      if (comp) {
        const attrs = comp.getAttributes() as Record<string, string>;
        setCurrentAttrs(attrs);
      } else {
        setCurrentAttrs({});
      }
      setAddingAttr(null);
    };
    editor.on("component:toggled", onToggle);
    return () => {
      editor.off("component:toggled", onToggle);
    };
  }, [editor]);

  const tagName = selected?.get("tagName") as string | undefined ?? "";
  const suggestions = ARIA_BY_TAG[tagName.toLowerCase()] ?? GENERIC_ARIA;
  const ariaAttrs = Object.entries(currentAttrs).filter(
    ([k]) => k.startsWith("aria-") || k === "role" || k === "alt" || k === "tabindex"
  );

  const handleAddAttr = useCallback(() => {
    if (!selected || !addingAttr) return;
    const val = addValue.trim();
    selected.addAttributes({ [addingAttr]: val });
    setCurrentAttrs(selected.getAttributes() as Record<string, string>);
    setAddingAttr(null);
    setAddValue("");
  }, [selected, addingAttr, addValue]);

  const handleRemoveAttr = useCallback((attr: string) => {
    if (!selected) return;
    selected.removeAttributes([attr]);
    setCurrentAttrs(selected.getAttributes() as Record<string, string>);
  }, [selected]);

  const startAdding = (attr: string, defaultVal?: string) => {
    setAddingAttr(attr);
    setAddValue(defaultVal ?? "");
  };

  // コントラスト計算
  const ratio = contrastRatio(fgColor, bgColor);
  const ratioStr = ratio.toFixed(2);
  const passAA     = ratio >= 4.5;
  const passAALarge = ratio >= 3;
  const passAAA    = ratio >= 7;
  const passAAALarge = ratio >= 4.5;

  return (
    <div className="a11y-panel">
      {/* ── コントラストチェッカー ── */}
      <section className="a11y-section">
        <div className="a11y-section-title">
          <i className="bi bi-circle-half" />
          コントラストチェッカー
        </div>
        <div className="a11y-contrast-colors">
          <label className="a11y-color-pick">
            <span>前景色</span>
            <div className="a11y-color-row">
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                className="a11y-color-input"
              />
              <input
                type="text"
                value={fgColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setFgColor(v);
                }}
                className="a11y-color-hex"
                maxLength={7}
              />
            </div>
          </label>
          <label className="a11y-color-pick">
            <span>背景色</span>
            <div className="a11y-color-row">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="a11y-color-input"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setBgColor(v);
                }}
                className="a11y-color-hex"
                maxLength={7}
              />
            </div>
          </label>
        </div>

        <div className="a11y-contrast-preview" style={{ color: fgColor, background: bgColor }}>
          <span className="a11y-preview-lg">Aa</span>
          <span className="a11y-preview-sm">サンプルテキスト</span>
        </div>

        <div className="a11y-ratio-display">
          <span className="a11y-ratio-value">{ratioStr}</span>
          <span className="a11y-ratio-label">: 1</span>
        </div>

        <div className="a11y-wcag-grid">
          <div className={`a11y-wcag-cell ${passAA ? "pass" : "fail"}`}>
            <span className="a11y-wcag-level">AA</span>
            <span className="a11y-wcag-size">標準文字</span>
            <span className="a11y-wcag-status">{passAA ? "✓ 合格" : "✗ 不合格"}</span>
            <span className="a11y-wcag-req">≥ 4.5</span>
          </div>
          <div className={`a11y-wcag-cell ${passAALarge ? "pass" : "fail"}`}>
            <span className="a11y-wcag-level">AA</span>
            <span className="a11y-wcag-size">大文字</span>
            <span className="a11y-wcag-status">{passAALarge ? "✓ 合格" : "✗ 不合格"}</span>
            <span className="a11y-wcag-req">≥ 3.0</span>
          </div>
          <div className={`a11y-wcag-cell ${passAAA ? "pass" : "fail"}`}>
            <span className="a11y-wcag-level">AAA</span>
            <span className="a11y-wcag-size">標準文字</span>
            <span className="a11y-wcag-status">{passAAA ? "✓ 合格" : "✗ 不合格"}</span>
            <span className="a11y-wcag-req">≥ 7.0</span>
          </div>
          <div className={`a11y-wcag-cell ${passAAALarge ? "pass" : "fail"}`}>
            <span className="a11y-wcag-level">AAA</span>
            <span className="a11y-wcag-size">大文字</span>
            <span className="a11y-wcag-status">{passAAALarge ? "✓ 合格" : "✗ 不合格"}</span>
            <span className="a11y-wcag-req">≥ 4.5</span>
          </div>
        </div>
      </section>

      {/* ── ARIA 属性ヘルパー ── */}
      <section className="a11y-section">
        <div className="a11y-section-title">
          <i className="bi bi-universal-access" />
          ARIA 属性ヘルパー
        </div>

        {!selected ? (
          <div className="a11y-empty">
            <i className="bi bi-cursor" />
            <p>コンポーネントを選択してください</p>
          </div>
        ) : (
          <>
            <div className="a11y-tag-badge">
              <code>&lt;{tagName || "div"}&gt;</code>
            </div>

            {/* 現在の ARIA 属性 */}
            {ariaAttrs.length > 0 && (
              <div className="a11y-current-attrs">
                <div className="a11y-attrs-label">現在の属性</div>
                {ariaAttrs.map(([key, val]) => (
                  <div key={key} className="a11y-attr-row">
                    <span className="a11y-attr-key">{key}</span>
                    <span className="a11y-attr-val">{String(val)}</span>
                    <button
                      className="a11y-attr-remove"
                      onClick={() => handleRemoveAttr(key)}
                      title="削除"
                    >
                      <i className="bi bi-x" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 属性追加フォーム */}
            {addingAttr && (
              <div className="a11y-add-form">
                <span className="a11y-add-attr-name">{addingAttr}</span>
                <input
                  className="a11y-add-input"
                  type="text"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  placeholder="値を入力..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddAttr();
                    if (e.key === "Escape") { setAddingAttr(null); setAddValue(""); }
                  }}
                />
                <div className="a11y-add-btns">
                  <button className="a11y-add-cancel" onClick={() => { setAddingAttr(null); setAddValue(""); }}>
                    キャンセル
                  </button>
                  <button className="a11y-add-ok" onClick={handleAddAttr}>
                    追加
                  </button>
                </div>
              </div>
            )}

            {/* サジェスト一覧 */}
            <div className="a11y-suggest-label">サジェスト</div>
            <div className="a11y-suggestions">
              {suggestions.map((s) => {
                const alreadySet = s.attr in currentAttrs;
                return (
                  <div key={s.attr} className={`a11y-suggest-item${alreadySet ? " set" : ""}`}>
                    <div className="a11y-suggest-info">
                      <span className="a11y-suggest-attr">{s.attr}</span>
                      <span className="a11y-suggest-hint">{s.hint}</span>
                    </div>
                    <button
                      className="a11y-suggest-btn"
                      disabled={alreadySet || !!addingAttr}
                      onClick={() => startAdding(s.attr, s.defaultValue)}
                      title={alreadySet ? "設定済み" : "追加"}
                    >
                      {alreadySet ? <i className="bi bi-check-lg" /> : <i className="bi bi-plus-lg" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
