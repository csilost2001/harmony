import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SchemaForm, type DynamicFormSchema } from "./SchemaForm";

function renderForm(schema: DynamicFormSchema, value: unknown = {}, onChange = vi.fn()) {
  render(<SchemaForm schema={schema} value={value} onChange={onChange} />);
  return onChange;
}

describe("SchemaForm", () => {
  it("string input is rendered and propagates changes", () => {
    const onChange = renderForm({
      type: "object",
      properties: { name: { type: "string" } },
    });

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "顧客登録" } });

    expect(onChange).toHaveBeenLastCalledWith({ name: "顧客登録" });
  });

  it("number input uses type=number and converts to number", () => {
    const onChange = renderForm({
      type: "object",
      properties: { amount: { type: "number" } },
    });
    const input = screen.getByLabelText("amount") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "12.5" } });

    expect(input.type).toBe("number");
    expect(onChange).toHaveBeenLastCalledWith({ amount: 12.5 });
  });

  it("integer input uses type=number and truncates decimal input", () => {
    const onChange = renderForm({
      type: "object",
      properties: { count: { type: "integer" } },
    });
    const input = screen.getByLabelText("count") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "8.9" } });

    expect(input.type).toBe("number");
    expect(onChange).toHaveBeenLastCalledWith({ count: 8 });
  });

  it("boolean input renders a checkbox", () => {
    const onChange = renderForm({
      type: "object",
      properties: { enabled: { type: "boolean" } },
    });
    const checkbox = screen.getByLabelText("enabled") as HTMLInputElement;

    fireEvent.click(checkbox);

    expect(checkbox.type).toBe("checkbox");
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });
  });

  it("enum renders a select with matching options", () => {
    const onChange = renderForm({
      type: "object",
      properties: { mode: { enum: ["AUTO", "MANUAL"] } },
    });
    const select = screen.getByLabelText("mode");

    expect(within(select).getByRole("option", { name: "AUTO" })).toBeTruthy();
    expect(within(select).getByRole("option", { name: "MANUAL" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "MANUAL" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "MANUAL" });
  });

  it("enum placeholder is disabled and selecting a value does not emit undefined", () => {
    const onChange = renderForm({
      type: "object",
      properties: { mode: { enum: ["AUTO", "MANUAL"] } },
    });
    const select = screen.getByLabelText("mode");
    const placeholder = within(select).getByRole("option", { name: "選択してください" }) as HTMLOptionElement;

    expect(placeholder.disabled).toBe(true);
    expect(placeholder.value).toBe("");

    fireEvent.change(select, { target: { value: "AUTO" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "AUTO" });
    expect(onChange).not.toHaveBeenCalledWith({ mode: undefined });
  });

  it("object properties render recursively and update parent values", () => {
    const onChange = renderForm(
      {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
      { config: { path: "old" } },
    );

    fireEvent.change(screen.getByLabelText("path"), { target: { value: "new" } });

    expect(onChange).toHaveBeenLastCalledWith({ config: { path: "new" } });
  });

  it("nested objects with same-named properties do not reuse DOM ids", () => {
    const { container } = render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            source: {
              type: "object",
              properties: { name: { type: "string" } },
            },
            target: {
              type: "object",
              properties: { name: { type: "string" } },
            },
          },
        }}
        value={{ source: { name: "from" }, target: { name: "to" } }}
        onChange={vi.fn()}
      />,
    );

    const labels = Array.from(container.querySelectorAll("label")).filter((label) => label.textContent === "name");
    const fieldIds = labels.map((label) => label.htmlFor);

    expect(labels).toHaveLength(2);
    expect(new Set(fieldIds).size).toBe(2);
    fieldIds.forEach((fieldId) => {
      expect(container.ownerDocument.getElementById(fieldId)).toBeInstanceOf(HTMLInputElement);
    });
  });

  it("array items render recursively and can be added and removed", () => {
    const onChange = renderForm(
      {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string", default: "new-tag" },
          },
        },
      },
      { tags: ["a"] },
    );

    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: ["a", "new-tag"] });

    fireEvent.click(screen.getByRole("button", { name: "tags 1 を削除" }));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [] });
  });

  it("required fields show a required marker", () => {
    renderForm({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });

    expect(screen.getByText("*")).toBeTruthy();
    expect(screen.getByText("必須項目です")).toBeTruthy();
  });

  it("description is rendered as help text", () => {
    renderForm({
      type: "object",
      properties: {
        batchId: { type: "string", description: "バッチ定義 ID" },
      },
    });

    expect(screen.getByText("バッチ定義 ID")).toBeTruthy();
  });

  it("default is applied on mount and shown as placeholder", async () => {
    const onChange = renderForm({
      type: "object",
      properties: {
        chunkSize: { type: "number", default: 100 },
      },
    });

    expect(screen.getByLabelText("chunkSize")).toHaveAttribute("placeholder", "100");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ chunkSize: 100 }));
  });

  it("nested object and array structures update the nested branch", () => {
    const onChange = renderForm(
      {
        type: "object",
        properties: {
          job: {
            type: "object",
            properties: {
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: { command: { type: "string" } },
                },
              },
            },
          },
        },
      },
      { job: { steps: [{ command: "load" }] } },
    );

    fireEvent.change(screen.getByLabelText("command"), { target: { value: "save" } });

    expect(onChange).toHaveBeenLastCalledWith({ job: { steps: [{ command: "save" }] } });
  });
});
