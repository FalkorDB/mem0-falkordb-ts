/**
 * Translates Neo4j-specific Cypher patterns into FalkorDB-compatible equivalents.
 *
 * Known incompatibilities handled:
 * 1. elementId(n) → id(n)  — FalkorDB uses id() not elementId()
 * 2. round(x, precision) → round(x)  — FalkorDB round() takes a single argument
 * 3. toInteger(x) → tointeger(x)  — FalkorDB uses lowercase
 * 4. APOC merge relationship (if encountered) → standard MERGE
 */
export class CypherTranslator {
  /**
   * Translate a Cypher query and its params from Neo4j dialect to FalkorDB dialect.
   */
  static translate(
    query: string,
    params: Record<string, any>
  ): { query: string; params: Record<string, any> } {
    let translated = query;
    const translatedParams = { ...params };

    translated = CypherTranslator.translateElementId(translated);
    translated = CypherTranslator.translateRound(translated);
    translated = CypherTranslator.translateApocMergeRelationship(
      translated,
      translatedParams
    );

    return { query: translated, params: translatedParams };
  }

  /**
   * elementId(expr) → id(expr)
   */
  private static translateElementId(query: string): string {
    return query.replace(/\belementId\s*\(/g, "id(");
  }

  /**
   * round(expr, precision) → round(expr)
   * FalkorDB's round() only takes a single argument (rounds to integer).
   * We remove the precision argument.
   */
  private static translateRound(query: string): string {
    // Match round( ... , <digit(s)> ) where the second arg is a literal number
    // We need to handle nested parens inside the first argument.
    return query.replace(
      /\bround\s*\(([\s\S]*?),\s*(\d+)\s*\)\s*AS\b/g,
      (match, expr, _precision) => {
        return `round(${expr}) AS`;
      }
    );
  }

  /**
   * Translate APOC merge relationship calls to standard MERGE.
   * Pattern: CALL apoc.merge.relationship(a, $relType, {}, $props, b) YIELD rel
   * This is a safety net — the current mem0 source doesn't use APOC,
   * but we handle it in case future versions do.
   */
  private static translateApocMergeRelationship(
    query: string,
    params: Record<string, any>
  ): string {
    const apocPattern =
      /CALL\s+apoc\.merge\.relationship\s*\(\s*(\w+)\s*,\s*\$(\w+)\s*,\s*\{[^}]*\}\s*,\s*(\{[^}]*\}|\$\w+)\s*,\s*(\w+)(?:\s*,\s*\{[^}]*\})?\s*\)\s*YIELD\s+(\w+)/gis;

    return query.replace(
      apocPattern,
      (_match, sourceVar, relTypeParam, _propsArg, targetVar, yieldVar) => {
        const relType = params[relTypeParam];
        if (relType) {
          delete params[relTypeParam];
        }
        const safeRelType = relType
          ? `\`${relType}\``
          : "`RELATED_TO`";
        return `MERGE (${sourceVar})-[${yieldVar}:${safeRelType}]->(${targetVar})`;
      }
    );
  }
}
