import { useState, useEffect, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

interface Props {
  open: boolean;
  initialHtml: string;
  componentName: string;
  onApply: (html: string) => void;
  onClose: () => void;
}

export function CodeEditorModal({ open, initialHtml, componentName, onApply, onClose }: Props) {
  const [html, setHtml] = useState(initialHtml);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHtml(initialHtml);
      setError(null);
    }
  }, [open, initialHtml]);

  // マウント時に自動整形を実行
  const handleEditorMount: OnMount = useCallback((editor) => {
    setTimeout(() => {
      editor.getAction("editor.action.formatDocument")?.run();
    }, 100);
  }, []);

  if (!open) return null;

  const handleApply = () => {
    const trimmed = html.trim();
    if (!trimmed) {
      setError("HTMLが空です");
      return;
    }
    try {
      const doc = new DOMParser().parseFromString(trimmed, "text/html");
      const parseError = doc.querySelector("parsererror");
      if (parseError) {
        setError("HTMLの解析に失敗しました: " + parseError.textContent?.slice(0, 100));
        return;
      }
    } catch {
      // DOMParser はほぼエラーを投げないが念のため
    }
    setError(null);
    onApply(trimmed);
  };

  return (
    <div className="code-modal-overlay" onClick={onClose}>
      <div className="code-modal" onClick={(e) => e.stopPropagation()}>
        <div className="code-modal-header">
          <div className="code-modal-title">
            <i className="bi bi-code-slash" />
            <span>HTMLソース編集</span>
            <span className="code-modal-component-name">{componentName}</span>
          </div>
          <button className="code-modal-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="code-modal-body">
          {error && (
            <div className="code-modal-error">
              <i className="bi bi-exclamation-triangle" /> {error}
            </div>
          )}
          <Editor
            language="html"
            theme="vs-dark"
            value={html}
            onChange={(v) => setHtml(v ?? "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              tabSize: 2,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              folding: true,
              bracketPairColorization: { enabled: true },
              formatOnPaste: true,
            }}
          />
        </div>

        <div className="code-modal-footer">
          <button className="code-btn code-btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button className="code-btn code-btn-primary" onClick={handleApply}>
            <i className="bi bi-check-lg" /> 適用
          </button>
        </div>
      </div>
    </div>
  );
}
