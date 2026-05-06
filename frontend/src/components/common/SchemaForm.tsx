import * as React from "react";
import { useEffect } from "react";

type SchemaPrimitive = string | number | boolean | null;

export interface DynamicFormSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  enum?: SchemaPrimitive[];
  properties?: Record<string, DynamicFormSchema>;
  items?: DynamicFormSchema;
  required?: string[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean;
}

export interface SchemaFormProps {
  schema: DynamicFormSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  required?: boolean;
  fieldName?: string;
}

export function SchemaForm({
  schema,
  value,
  onChange,
  required = false,
  fieldName,
}: SchemaFormProps) {
  const reactId = React.useId();

  useEffect(() => {
    if (value === undefined && Object.prototype.hasOwnProperty.call(schema, "default")) {
      onChange(schema.default);
    }
  }, [onChange, schema, value]);

  const fieldId = `${reactId}-${fieldName ?? "root"}`;
  const invalid = required && isEmptyValue(value);

  if (schema.enum) {
    return (
      <FieldFrame fieldName={fieldName} fieldId={fieldId} schema={schema} required={required} invalid={invalid}>
        <select
          id={fieldId}
          className={`form-select form-select-sm${invalid ? " is-invalid" : ""}`}
          value={valueToInputValue(value)}
          onChange={(e) => {
            const next = schema.enum?.find((item) => valueToInputValue(item) === e.target.value);
            if (next !== undefined) onChange(next);
          }}
        >
          <option value="" disabled>
            選択してください
          </option>
          {schema.enum.map((item) => (
            <option key={valueToInputValue(item)} value={valueToInputValue(item)}>
              {String(item)}
            </option>
          ))}
        </select>
      </FieldFrame>
    );
  }

  if (schema.type === "string") {
    return (
      <FieldFrame fieldName={fieldName} fieldId={fieldId} schema={schema} required={required} invalid={invalid}>
        <input
          id={fieldId}
          type="text"
          className={`form-control form-control-sm${invalid ? " is-invalid" : ""}`}
          value={typeof value === "string" ? value : ""}
          placeholder={placeholderFor(schema)}
          onChange={(e) => onChange(e.target.value)}
        />
      </FieldFrame>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <FieldFrame fieldName={fieldName} fieldId={fieldId} schema={schema} required={required} invalid={invalid}>
        <input
          id={fieldId}
          type="number"
          step={schema.type === "integer" ? 1 : "any"}
          className={`form-control form-control-sm${invalid ? " is-invalid" : ""}`}
          value={typeof value === "number" ? String(value) : ""}
          placeholder={placeholderFor(schema)}
          onChange={(e) => {
            const next = e.target.value === "" ? undefined : Number(e.target.value);
            onChange(schema.type === "integer" && typeof next === "number" ? Math.trunc(next) : next);
          }}
        />
      </FieldFrame>
    );
  }

  if (schema.type === "boolean") {
    return (
      <FieldFrame fieldName={fieldName} fieldId={fieldId} schema={schema} required={required} invalid={invalid}>
        <div className="form-check">
          <input
            id={fieldId}
            type="checkbox"
            className="form-check-input"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      </FieldFrame>
    );
  }

  if (schema.type === "object") {
    const current = isRecord(value) ? value : {};
    const properties = schema.properties ?? {};
    const requiredFields = new Set(schema.required ?? []);

    return (
      <fieldset className={fieldName ? "border rounded p-2 mb-2" : ""}>
        {fieldName ? (
          <legend className="float-none w-auto px-1 fs-6 mb-1">
            {fieldName}
            {required ? <span className="text-danger ms-1">*</span> : null}
          </legend>
        ) : null}
        {schema.description ? <small className="form-text text-muted d-block mb-2">{schema.description}</small> : null}
        {Object.entries(properties).map(([key, childSchema]) => (
          <SchemaForm
            key={key}
            schema={childSchema}
            value={current[key]}
            required={requiredFields.has(key)}
            fieldName={key}
            onChange={(next) => {
              const updated = { ...current };
              if (next === undefined) {
                delete updated[key];
              } else {
                updated[key] = next;
              }
              onChange(updated);
            }}
          />
        ))}
      </fieldset>
    );
  }

  if (schema.type === "array") {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? { type: "string" };

    return (
      <FieldFrame fieldName={fieldName} fieldId={fieldId} schema={schema} required={required} invalid={invalid}>
        <div className="d-flex flex-column gap-2">
          {items.map((item, index) => (
            <div key={index} className="d-flex gap-2 align-items-start">
              <div className="flex-grow-1">
                <SchemaForm
                  schema={itemSchema}
                  value={item}
                  fieldName={`${fieldName ?? "item"} ${index + 1}`}
                  onChange={(next) => onChange(items.map((current, i) => (i === index ? next : current)))}
                />
              </div>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`${fieldName ?? "項目"} ${index + 1} を削除`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                削除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-outline-primary btn-sm align-self-start"
            onClick={() => onChange([...items, defaultForSchema(itemSchema)])}
          >
            追加
          </button>
        </div>
      </FieldFrame>
    );
  }

  return <div className="alert alert-warning py-2 mb-2">未対応スキーマ</div>;
}

interface FieldFrameProps {
  children: React.ReactNode;
  fieldName?: string;
  fieldId: string;
  schema: DynamicFormSchema;
  required: boolean;
  invalid: boolean;
}

function FieldFrame({ children, fieldName, fieldId, schema, required, invalid }: FieldFrameProps) {
  return (
    <div className="mb-2" data-field-name={fieldName}>
      {fieldName ? (
        <label htmlFor={fieldId} className="form-label mb-1">
          {fieldName}
          {required ? <span className="text-danger ms-1">*</span> : null}
        </label>
      ) : null}
      {children}
      {schema.description ? <small className="form-text text-muted">{schema.description}</small> : null}
      {invalid ? <div className="invalid-feedback d-block">必須項目です</div> : null}
    </div>
  );
}

function defaultForSchema(schema: DynamicFormSchema): unknown {
  if (Object.prototype.hasOwnProperty.call(schema, "default")) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === "object") return {};
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "number" || schema.type === "integer") return 0;
  return "";
}

function placeholderFor(schema: DynamicFormSchema): string | undefined {
  return Object.prototype.hasOwnProperty.call(schema, "default") ? String(schema.default) : undefined;
}

function valueToInputValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
