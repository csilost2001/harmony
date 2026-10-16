import { useState, useRef, useCallback, useMemo } from "react";
import { computeReferenceCompletion, insertReferenceCandidate } from "../utils/reference-completer/completer";
import type { Candidate, CompletionContext, Resolver } from "../utils/reference-completer/types";
import { bestRank } from "../utils/textMatch";
import { applyCompletionHistory, recordCompletionPick } from "../utils/completionHistory";
import { isImeComposing } from "../utils/imeKeys";
import { referenceAt, requestFindReferences, requestGoToReference } from "../utils/referenceTarget";
import { showToast } from "../utils/toast";
import { hasRefDrag, insertRefAt, readRefDrop } from "../utils/refDrag";

type El = HTMLInputElement | HTMLTextAreaElement;

interface Options {
  value: string;
  onValueChange: (v: string) => void;
  onCommit?: () => void;
  resolvers: Resolver[];
  ctx: CompletionContext;
  /** Enter でも候補を確定する (input)。textarea は改行のため Tab だけ。 */
  pickOnEnter: boolean;
}

/**
 * 参照補完 (ポップアップ付きの入力欄) の共通の動き。
 * 操作: ↑↓ で選ぶ / Tab (input は Enter も) で確定 / Esc で閉じる / Ctrl+Space で開く。
 * 日本語の変換中は何もしない。選んだ候補は覚えて、次から上位に出す。
 */
export function useReferenceCompletion<T extends El>({ value, onValueChange, onCommit, resolvers, ctx, pickOnEnter }: Options) {
  const inputRef = useRef<T>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // マウント直後はフォーカスされていないため抑制状態で開始 (#1438)
  const [suppressed, setSuppressed] = useState(true);

  const candidates: Candidate[] = useMemo(() => {
    if (suppressed) return [];
    const state = computeReferenceCompletion(value, cursorPos, resolvers, ctx);
    if (state.phase !== "active") return [];
    const prefix = state.prefix;
    return applyCompletionHistory(state.resolverId, state.candidates, (c) => {
      const r = bestRank([c.value, c.label], prefix);
      return r === -1 ? 2 : r;
    });
  }, [suppressed, value, cursorPos, resolvers, ctx]);
  const isOpen = candidates.length > 0;
  const safeIndex = isOpen ? Math.min(activeIndex, candidates.length - 1) : 0;

  const pick = useCallback(
    (candidate: Candidate) => {
      const pos = inputRef.current?.selectionStart ?? value.length;
      const st = computeReferenceCompletion(value, pos, resolvers, ctx);
      if (st.phase === "idle") return;
      const { newValue, newCursor } = insertReferenceCandidate(value, pos, st, candidate);
      recordCompletionPick(st.resolverId, candidate.value);
      onValueChange(newValue);
      setSuppressed(false);
      setActiveIndex(0);
      setCursorPos(newCursor);
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(newCursor, newCursor);
        inputRef.current?.focus();
      });
    },
    [value, resolvers, ctx, onValueChange],
  );

  /** カーソル (またはクリック位置) の参照の定義を開く。参照の上でなければ案内する */
  const goToDefinition = (pos: number) => {
    const target = referenceAt(value, pos);
    if (!target) {
      showToast("参照 (@screen.cart のような @ で始まる指定) の上にカーソルを置いてください", "info");
      return;
    }
    requestGoToReference(target);
  };

  /** カーソルの参照を、参照している設計の一覧にする (Shift+F12) */
  const findReferences = (pos: number) => {
    const target = referenceAt(value, pos);
    if (!target) {
      showToast("参照 (@screen.cart のような @ で始まる指定) の上にカーソルを置いてください", "info");
      return;
    }
    requestFindReferences(target);
  };

  const onKeyDown = (e: React.KeyboardEvent<T>) => {
    if (isImeComposing(e)) return;
    if (e.key === "F12" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      findReferences(inputRef.current?.selectionStart ?? cursorPos);
      return;
    }
    if (e.key === "F12" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      goToDefinition(inputRef.current?.selectionStart ?? cursorPos);
      return;
    }
    if (e.key === " " && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      setCursorPos(inputRef.current?.selectionStart ?? value.length);
      setSuppressed(false);
      return;
    }
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Tab" || (pickOnEnter && e.key === "Enter")) {
      if (candidates[safeIndex]) {
        e.preventDefault();
        pick(candidates[safeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setSuppressed(true);
    }
  };

  const handlers = {
    onChange: (e: React.ChangeEvent<T>) => {
      setCursorPos(e.target.selectionStart ?? e.target.value.length);
      setActiveIndex(0);
      setSuppressed(false);
      onValueChange(e.target.value);
    },
    onKeyDown,
    onClick: (e: React.MouseEvent<T>) => {
      // Ctrl (Mac は ⌘) + クリックで、参照の定義を開く
      if (!(e.ctrlKey || e.metaKey)) return;
      const pos = (e.currentTarget as T).selectionStart;
      if (pos !== null && referenceAt(value, pos)) {
        e.preventDefault();
        goToDefinition(pos);
      }
    },
    onSelect: (e: React.SyntheticEvent<T>) => {
      setCursorPos((e.target as T).selectionStart ?? 0);
    },
    onBlur: () => {
      setTimeout(() => setSuppressed(true), 150);
      onCommit?.();
    },
    onFocus: () => setSuppressed(false),
    // 一覧などから、参照 (@screen.cart のような指定) をドラッグして落とすと、カーソルの位置へ入れる
    onDragOver: (e: React.DragEvent<T>) => {
      if (!hasRefDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: React.DragEvent<T>) => {
      const ref = readRefDrop(e.dataTransfer);
      if (!ref) return;
      e.preventDefault();
      const el = e.currentTarget as T;
      const at = insertRefAt(value, el.selectionStart ?? value.length, el.selectionEnd ?? el.selectionStart ?? value.length, ref);
      onValueChange(at.value);
      setCursorPos(at.cursor);
      setSuppressed(true);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(at.cursor, at.cursor); });
    },
  };

  return { inputRef, candidates, isOpen, safeIndex, pick, handlers };
}
