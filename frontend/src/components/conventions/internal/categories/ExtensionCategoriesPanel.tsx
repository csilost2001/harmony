/**
 * ExtensionCategoriesPanel — `extensions.v3` の conventionCategories 読み取り専用表示 (#1145 Phase-5)
 *
 * `@conv.<categoryName>.<key>` の業界規約拡張を一覧表示。
 */

export interface ExtensionCategoriesPanelProps {
  extensionCategories?: Record<string, Record<string, unknown>>;
}

export function ExtensionCategoriesPanel({
  extensionCategories,
}: ExtensionCategoriesPanelProps) {
  const entries = Object.entries(extensionCategories ?? {});
  return (
    <section className="conventions-extension-categories">
      <h3 className="conventions-section-title">
        <i className="bi bi-puzzle" /> 拡張カテゴリ
        <small className="text-muted ms-2">
          (extensions.v3 の conventionCategories で定義、`@conv.&lt;categoryName&gt;.&lt;key&gt;` で参照)
        </small>
      </h3>
      {entries.length === 0 ? (
        <div className="conventions-empty">拡張カテゴリは定義されていません。</div>
      ) : (
        <table className="conventions-table">
          <thead>
            <tr>
              <th>カテゴリ名</th>
              <th>エントリ数</th>
              <th>キー一覧</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([catName, catEntries]) => {
              const keys = Object.keys(catEntries ?? {});
              return (
                <tr key={catName}>
                  <td><code className="conventions-key-badge">@conv.{catName}.*</code></td>
                  <td>{keys.length}</td>
                  <td className="text-muted">
                    {keys.length > 0 ? keys.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
