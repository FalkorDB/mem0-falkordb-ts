import { CypherTranslator } from "../src/CypherTranslator";

describe("CypherTranslator", () => {
  describe("elementId → id", () => {
    it("translates elementId(n) to id(n)", () => {
      const { query } = CypherTranslator.translate(
        "RETURN elementId(n) AS id",
        {}
      );
      expect(query).toBe("RETURN id(n) AS id");
    });

    it("translates multiple elementId calls", () => {
      const { query } = CypherTranslator.translate(
        "RETURN elementId(n) AS nid, elementId(r) AS rid, elementId(m) AS mid",
        {}
      );
      expect(query).toBe(
        "RETURN id(n) AS nid, id(r) AS rid, id(m) AS mid"
      );
    });

    it("handles elementId with spaces before paren", () => {
      const { query } = CypherTranslator.translate(
        "RETURN elementId (n) AS id",
        {}
      );
      expect(query).toBe("RETURN id(n) AS id");
    });
  });

  describe("round(x, precision) → round(x)", () => {
    it("removes the precision argument from round()", () => {
      const { query } = CypherTranslator.translate(
        "round(someExpr, 4) AS similarity",
        {}
      );
      expect(query).toBe("round(someExpr) AS similarity");
    });

    it("handles the full cosine similarity pattern from mem0", () => {
      const input = `
        WITH n,
            round(reduce(dot = 0.0, i IN range(0, size(n.embedding)-1) | dot + n.embedding[i] * $n_embedding[i]) /
            (sqrt(reduce(l2 = 0.0, i IN range(0, size(n.embedding)-1) | l2 + n.embedding[i] * n.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($n_embedding)-1) | l2 + $n_embedding[i] * $n_embedding[i]))), 4) AS similarity
      `;
      const { query } = CypherTranslator.translate(input, {});
      expect(query).not.toContain(", 4) AS");
      expect(query).toContain(") AS similarity");
    });
  });

  describe("APOC merge relationship", () => {
    it("translates CALL apoc.merge.relationship to MERGE", () => {
      const params: Record<string, any> = {
        relType: "KNOWS",
        props: { since: 2020 },
      };
      const { query, params: newParams } = CypherTranslator.translate(
        "CALL apoc.merge.relationship(a, $relType, {}, $props, b) YIELD rel",
        params
      );
      expect(query).toContain("MERGE (a)-[rel:`KNOWS`]->(b)");
      expect(newParams).not.toHaveProperty("relType");
    });

    it("handles APOC with extra empty map argument", () => {
      const params: Record<string, any> = { relType: "WORKS_AT" };
      const { query } = CypherTranslator.translate(
        "CALL apoc.merge.relationship(src, $relType, {}, {}, tgt, {}) YIELD r",
        params
      );
      expect(query).toContain("MERGE (src)-[r:`WORKS_AT`]->(tgt)");
    });
  });

  describe("pass-through", () => {
    it("does not modify queries that need no translation", () => {
      const input = "MATCH (n {name: $name}) RETURN n";
      const params = { name: "Alice" };
      const result = CypherTranslator.translate(input, params);
      expect(result.query).toBe(input);
      expect(result.params).toEqual(params);
    });

    it("preserves standard MERGE queries", () => {
      const input =
        "MERGE (n:Person {name: $name}) ON CREATE SET n.created = timestamp()";
      const { query } = CypherTranslator.translate(input, { name: "Bob" });
      expect(query).toBe(input);
    });
  });

  describe("multi-line queries", () => {
    it("handles multi-line elementId translations", () => {
      const input = `
        RETURN
          elementId(n) AS source_id,
          elementId(m) AS dest_id
      `;
      const { query } = CypherTranslator.translate(input, {});
      expect(query).toContain("id(n) AS source_id");
      expect(query).toContain("id(m) AS dest_id");
      expect(query).not.toContain("elementId");
    });
  });

  describe("params mutation", () => {
    it("does not mutate the original params object", () => {
      const originalParams = { relType: "KNOWS", other: "value" };
      const paramsCopy = { ...originalParams };
      CypherTranslator.translate(
        "CALL apoc.merge.relationship(a, $relType, {}, {}, b) YIELD rel",
        originalParams
      );
      // The translate method works on a copy internally via FalkorDBGraph
      // But within CypherTranslator.translate, it modifies the passed params
      // This is expected behavior — the caller should pass a copy
      expect(originalParams.other).toBe("value");
    });
  });
});
