import { describe, expect, it } from "vitest";
import { buildShapeEnv, selectShape } from "./sqlShape";

describe("selectShape (検索の結果が 1 件か一覧か)", () => {
  it("1 件: LIMIT 1・TOP 1・FETCH FIRST 1・集計だけ・主キーの一致", () => {
    for (const q of [
      "SELECT * FROM t WHERE code = @inputs.code LIMIT 1",
      "SELECT * FROM t LIMIT 1 OFFSET 5",
      "SELECT TOP 1 * FROM t",
      "SELECT * FROM t FETCH FIRST 1 ROWS ONLY",
      "SELECT COUNT(*) AS n, SUM(x) AS s FROM t WHERE a = @inputs.a",
      "SELECT id FROM t WHERE id = @inputs.id",
      'SELECT c.id FROM customers c WHERE c."id" = @inputs.customerId AND c.active = true',
      "SELECT id FROM t WHERE `id` = @x",
      "SELECT id FROM t WHERE [id] = @x",
      "SELECT id FROM t WHERE id = $1",
      "SELECT COALESCE(SUM(CASE WHEN c.k = 'a' THEN t.amount ELSE 0 END), 0) AS total FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.d >= @from",
    ]) expect(selectShape(q), q).toBe("one");
  });
  it("一覧: 絞り込みのない・主キーでない・OR・IN・GROUP BY・JOIN・LIMIT 10", () => {
    for (const q of [
      "SELECT id, name FROM t WHERE store_id = @inputs.storeId",
      "SELECT id FROM t WHERE parent_id = @inputs.p",
      "SELECT id FROM t WHERE id != @x",
      "SELECT id FROM t WHERE id IN (1, 2)",
      "SELECT id FROM t WHERE active = true OR id = @x",
      "SELECT a, COUNT(*) AS n FROM t GROUP BY a",
      "SELECT * FROM t LIMIT 10",
      "SELECT ci.id FROM carts c JOIN cart_items ci ON ci.cart_id = c.id WHERE c.id = @cartId",
      "SELECT id FROM t",
    ]) expect(selectShape(q), q).toBe("list");
  });
  it("部分クエリ・窓関数・コメント・文字列の中は見ない", () => {
    expect(selectShape("SELECT p.id, (SELECT url FROM photos WHERE post_id = p.id LIMIT 1) AS thumb FROM posts p WHERE p.user_id = @u")).toBe("list");
    expect(selectShape("SELECT p.id, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS n FROM posts p")).toBe("list");
    expect(selectShape("SELECT id, COUNT(*) OVER () AS total FROM posts")).toBe("list");
    expect(selectShape("SELECT id, MAX(price) OVER (PARTITION BY k) AS m FROM posts")).toBe("list");
    expect(selectShape("SELECT id FROM t -- WHERE id = @x\n")).toBe("list");
    expect(selectShape("SELECT id FROM t /* LIMIT 1 */ WHERE note = 'id = @x'")).toBe("list");
    expect(selectShape("WITH x AS (SELECT id FROM t LIMIT 1) SELECT id FROM y WHERE k = @k")).toBe("list");
  });
  it("テーブルの定義があれば、主キー・一意の列で判定する (コードの検索も 1 件)", () => {
    const env = buildShapeEnv([
      { physicalName: "products", uniqueKeys: [["id"], ["product_code"]] },
      { physicalName: "order_lines", uniqueKeys: [["order_id", "line_no"]] },
    ]);
    expect(selectShape("SELECT id FROM products WHERE product_code = @inputs.code AND active = true", env)).toBe("one");
    expect(selectShape("SELECT id FROM products WHERE name = @inputs.name", env)).toBe("list");
    expect(selectShape("SELECT * FROM order_lines WHERE order_id = @o", env)).toBe("list");
    expect(selectShape("SELECT * FROM order_lines WHERE order_id = @o AND line_no = @n", env)).toBe("one");
    // 多対 1 の結合 (結合先の主キーで結ぶ) は、行が増えない。1 対多 (子の行) は増える
    expect(selectShape("SELECT p.id, u.name FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = @x")).toBe("one");
    expect(selectShape("SELECT ci.id FROM carts c JOIN cart_items ci ON ci.cart_id = c.id WHERE c.id = @cartId")).toBe("list");
    // 定義が無いテーブルは、id の一致だけを主キーとみなす
    expect(selectShape("SELECT id FROM unknown_t WHERE id = @x", env)).toBe("one");
    expect(selectShape("SELECT id FROM unknown_t WHERE product_code = @x", env)).toBe("list");
  });
  it("昔の書き方の結合 (別名つきのカンマ)・LIMIT 1, 5・文字列の中の -- や /*", () => {
    expect(selectShape("SELECT * FROM carts c, cart_items ci WHERE c.id = @x AND ci.cart_id = c.id")).toBe("list");
    expect(selectShape("SELECT * FROM t LIMIT 1, 5")).toBe("list");
    expect(selectShape("SELECT * FROM posts WHERE note <> 'a -- b' AND id = @s")).toBe("one");
    expect(selectShape("SELECT * FROM posts WHERE url LIKE 'http://x/*%' AND id = @s /* c */")).toBe("one");
  });
});
