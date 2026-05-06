import { useCallback, useEffect, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadExtensionsFromBundle } from "../../schemas/loadExtensions";
import { SchemaForm, type DynamicFormSchema } from "../common/SchemaForm";

interface LoadState {
  loading: boolean;
  schema: DynamicFormSchema | null;
  error: string | null;
}

export interface CustomStepPanelProps {
  customStepType: string;
  value: unknown;
  onChange: (next: unknown) => void;
}

export function CustomStepPanel({ customStepType, value, onChange }: CustomStepPanelProps) {
  const [state, setState] = useState<LoadState>({
    loading: true,
    schema: null,
    error: null,
  });

  const reload = useCallback(async (forceReload = false) => {
    try {
      const bundle = await mcpBridge.getExtensions(forceReload);
      const result = loadExtensionsFromBundle(bundle);
      const schema = result.extensions.steps[customStepType]?.schema;

      if (!schema) {
        setState({
          loading: false,
          schema: null,
          error: `カスタムステップ "${customStepType}" の定義が見つかりません`,
        });
        return;
      }

      setState({ loading: false, schema, error: null });
    } catch (e) {
      setState({
        loading: false,
        schema: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [customStepType]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload(false);
    }, 0);
    const unsubscribe = mcpBridge.onExtensionsChanged(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      void reload(true);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [reload]);

  if (state.loading) {
    return <div className="text-muted small">カスタムステップ定義を読み込み中...</div>;
  }

  if (state.error) {
    return <div className="alert alert-danger py-2 mb-2">{state.error}</div>;
  }

  if (!state.schema) {
    return <div className="alert alert-warning py-2 mb-2">未対応スキーマ</div>;
  }

  return <SchemaForm schema={state.schema} value={value} onChange={onChange} />;
}
