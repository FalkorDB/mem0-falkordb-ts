# Agent Task: Build `@falkordb/mem0` — FalkorDB Graph Store for mem0 TypeScript SDK

## Objective

Create a standalone npm package `@falkordb/mem0` that adds FalkorDB as a graph store backend for the `mem0ai` TypeScript SDK (`mem0ai/oss`) **without modifying mem0's source code**.

---

## Background & Architecture

The mem0 TypeScript SDK (`mem0ai/oss`) supports graph memory via a `MemoryGraph` class that is instantiated internally by `Memory` when `enableGraph: true`. The `MemoryGraph` class holds a `this.graph` driver object (currently only `neo4j` or `kuzu`) and runs Cypher queries against it.

The extension strategy:
1. Export a `FalkorMemory` class that **extends** `Memory` from `mem0ai/oss`
2. In the constructor, if `graphStore.provider === "falkordb"`, call `super()` with a patched config, then **replace** `(this as any).memoryGraph.graph` with a `FalkorDBGraph` adapter instance
3. `FalkorDBGraph` uses the official `falkordb` npm package (not the neo4j driver)
4. A `CypherTranslator` utility rewrites the few Neo4j-specific Cypher patterns mem0 uses into FalkorDB-compatible equivalents — specifically replacing APOC procedure calls

### Key Cypher incompatibilities to handle

mem0's `MemoryGraph` runs these problematic patterns:

| Neo4j pattern mem0 uses | FalkorDB equivalent |
|---|---|
| `CALL apoc.merge.relationship(a, $relType, {}, $props, b)` | `CALL falkordb.algo.merge_relationship(...)` does not exist — rewrite as a manual `MERGE (a)-[r:\`${relType}\`]->(b) SET r += $props` |
| `apoc.convert.fromJsonList(...)` | Not needed — mem0 passes arrays directly |
| Node label `__Entity__` | Works as-is in FalkorDB |
| `n.embedding` cosine similarity via `reduce()` | Works as-is; FalkorDB also has `vec.cosineDistance` but the reduce approach is fine |

---

## Repository Structure to Create

```
@falkordb/mem0/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── .eslintrc.json
├── jest.config.ts
├── README.md
├── src/
│   ├── index.ts                  # Public exports
│   ├── FalkorMemory.ts           # Extends Memory from mem0ai/oss
│   ├── FalkorMemoryGraph.ts      # Full reimplementation of MemoryGraph using FalkorDB
│   ├── FalkorDBGraph.ts          # Low-level FalkorDB driver wrapper
│   ├── CypherTranslator.ts       # Rewrites APOC and neo4j-specific Cypher
│   └── types.ts                  # FalkorDB-specific config types
└── tests/
    ├── CypherTranslator.test.ts
    ├── FalkorDBGraph.test.ts
    └── FalkorMemory.integration.test.ts
```

---

## Detailed Implementation Spec

### `package.json`

```json
{
  "name": "@falkordb/mem0",
  "version": "0.1.0",
  "description": "FalkorDB graph store backend for the mem0ai TypeScript SDK",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "peerDependencies": {
    "mem0ai": ">=2.0.0"
  },
  "dependencies": {
    "falkordb": "^6.0.0"
  },
  "devDependencies": {
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0",
    "mem0ai": "^2.2.3"
  }
}
```

### `src/types.ts`

Define the FalkorDB-specific config that extends mem0's `MemoryConfig`:

```typescript
export interface FalkorDBConfig {
  host: string;          // default: "localhost"
  port: number;          // default: 6380
  password?: string;     // optional auth
  graphName?: string;    // default: "mem0"
}

export interface FalkorGraphStoreConfig {
  provider: "falkordb";
  config: FalkorDBConfig;
  llm?: {
    provider: string;
    config: Record<string, any>;
  };
  customPrompt?: string;
}

// Extends mem0's MemoryConfig but allows provider: "falkordb"
export interface FalkorMemoryConfig {
  version?: string;
  embedder: { provider: string; config: Record<string, any> };
  vectorStore: { provider: string; config: Record<string, any> };
  llm: { provider: string; config: Record<string, any> };
  historyDbPath?: string;
  customPrompt?: string;
  enableGraph?: boolean;
  graphStore?: FalkorGraphStoreConfig;
  disableHistory?: boolean;
}
```

### `src/CypherTranslator.ts`

This is the most critical piece. Implement a class with a static `translate(query: string, params: Record<string, any>): { query: string; params: Record<string, any> }` method.

Translations required:

1. **APOC merge relationship** — mem0 calls:
   ```cypher
   CALL apoc.merge.relationship(a, $relType, {}, {}, b, {}) YIELD rel
   ```
   Translate to:
   ```cypher
   // FalkorDB does not support dynamic relationship types in MERGE via variables.
   // Rewrite as: check existence then create if missing.
   // Since relType is a param, the translator must detect this pattern and
   // convert to a template that inlines the relType value at query time.
   ```
   The cleanest approach: detect the `apoc.merge.relationship` call, extract the `$relType` parameter name from `params`, inline the actual value into the Cypher using a backtick-quoted relationship type, and return the rewritten query without the `$relType` param.

   Output:
   ```cypher
   MATCH (a), (b) WHERE ... 
   MERGE (a)-[rel:`KNOWS`]->(b)
   RETURN rel
   ```

2. **APOC JSON conversion** — if present, remove or inline.

3. **`elementId(n)` → `id(n)`** — FalkorDB uses `id()` not `elementId()`.

4. **`datetime()` → `timestamp()`** — FalkorDB uses `timestamp()` for current time.

Implement each as a named private static method and compose them in `translate()`.

Write the translator so it handles multi-line queries (use regex with `s` flag).

### `src/FalkorDBGraph.ts`

Wraps the `falkordb` npm client. The interface this must satisfy (what mem0's MemoryGraph calls on `this.graph`):

```typescript
interface GraphDriver {
  query(cypher: string, params?: Record<string, any>): Promise<any[]>;
  close(): Promise<void>;
}
```

Implementation notes:
- Use `import { FalkorDB, Graph } from 'falkordb'`
- The `falkordb` package's `Graph.query()` returns a `QueryResult` — extract `.data` from it
- Handle the case where `result.data` is undefined (DDL queries return no data)
- Wrap all query errors with context (include the query string in the error message)
- Implement `close()` to call `this.client.close()`
- Before running queries, run schema setup: create indexes on `(__Entity__ {name})` and `(__Entity__ {user_id})`

### `src/FalkorMemoryGraph.ts`

This is a **full reimplementation** of mem0's internal `MemoryGraph` class that uses `FalkorDBGraph` + `CypherTranslator` instead of the neo4j driver.

Read the mem0 source carefully (it is available in `node_modules/mem0ai/dist/oss/index.js`) to understand exactly what methods `MemoryGraph` exposes and what queries it runs, then reimplement them.

The methods to implement:

```typescript
class FalkorMemoryGraph {
  constructor(config: FalkorMemoryConfig) { ... }
  
  async add(data: string, filters: Record<string, any>): Promise<any[]>
  async search(query: string, filters: Record<string, any>, limit?: number): Promise<any[]>
  async deleteAll(filters: Record<string, any>): Promise<void>
  async getAll(filters: Record<string, any>): Promise<any[]>
}
```

Each method should:
1. Use the same LLM calls as mem0 (entity extraction, relationship extraction) — reuse the LLM factory from mem0 by importing `LLMFactory` from `mem0ai/oss` if exported, or replicate the pattern
2. Build the Cypher query exactly as mem0 does
3. Pass the query through `CypherTranslator.translate()` before executing
4. Execute via `this.graph.query(translatedQuery, translatedParams)`

### `src/FalkorMemory.ts`

```typescript
import { Memory } from "mem0ai/oss";
import { FalkorMemoryGraph } from "./FalkorMemoryGraph";
import { FalkorMemoryConfig } from "./types";

export class FalkorMemory extends Memory {
  constructor(config: FalkorMemoryConfig) {
    if (config.graphStore?.provider !== "falkordb") {
      // Pass through to normal Memory for non-falkordb configs
      super(config as any);
      return;
    }

    const falkorConfig = config.graphStore.config;

    // Call super with neo4j provider as placeholder to satisfy mem0's
    // config validation — we'll replace the graph instance immediately after
    super({
      ...config,
      graphStore: {
        provider: "neo4j",
        config: {
          url: `bolt://${falkorConfig.host}:${falkorConfig.port}`,
          username: "falkordb",
          password: falkorConfig.password ?? "",
        },
        llm: config.graphStore.llm,
        customPrompt: config.graphStore.customPrompt,
      },
    } as any);

    // Replace the internal MemoryGraph instance with our FalkorDB implementation
    (this as any).memoryGraph = new FalkorMemoryGraph(config);
  }
}
```

**Important:** After calling `super()`, mem0 will have attempted to connect to neo4j and may throw. To avoid this, check if mem0 lazily initializes the graph (i.e., only connects on first `add()` call) vs eagerly in the constructor. If it connects eagerly, use a different strategy: pass `enableGraph: false` to super and manually set `(this as any).enableGraph = true` and `(this as any).memoryGraph = new FalkorMemoryGraph(config)`.

### `src/index.ts`

```typescript
export { FalkorMemory } from "./FalkorMemory";
export { FalkorMemoryGraph } from "./FalkorMemoryGraph";
export { FalkorDBGraph } from "./FalkorDBGraph";
export { CypherTranslator } from "./CypherTranslator";
export type { FalkorMemoryConfig, FalkorDBConfig, FalkorGraphStoreConfig } from "./types";
```

---

## Tests

### `tests/CypherTranslator.test.ts`

Test every translation case exhaustively:

- APOC merge relationship → inline MERGE
- `elementId()` → `id()`  
- `datetime()` → `timestamp()`
- Pass-through of queries that need no translation
- Multi-line query handling
- Params object is correctly mutated (relType removed when inlined)

### `tests/FalkorDBGraph.test.ts`

Use `jest.mock('falkordb')` to mock the FalkorDB client. Test:

- Constructor connects with correct host/port
- `query()` calls `graph.query()` with correct args and unwraps `.data`
- `query()` passes through `CypherTranslator.translate()` 
- `close()` calls `client.close()`
- Error handling wraps errors with query context

### `tests/FalkorMemory.integration.test.ts`

Mark as `@group integration` (skip in CI unless `FALKORDB_HOST` env var is set). Test against a real FalkorDB instance:

```typescript
describe("FalkorMemory integration", () => {
  let memory: FalkorMemory;

  beforeAll(async () => {
    if (!process.env.FALKORDB_HOST) {
      pending("FALKORDB_HOST not set, skipping integration tests");
    }
    memory = new FalkorMemory({
      enableGraph: true,
      graphStore: {
        provider: "falkordb",
        config: {
          host: process.env.FALKORDB_HOST!,
          port: parseInt(process.env.FALKORDB_PORT ?? "6380"),
          graphName: "mem0_test",
        },
      },
      llm: {
        provider: "openai",
        config: { apiKey: process.env.OPENAI_API_KEY! },
      },
      embedder: {
        provider: "openai", 
        config: { apiKey: process.env.OPENAI_API_KEY! },
      },
      vectorStore: {
        provider: "memory",
        config: { dimension: 1536 },
      },
    });
  });

  afterAll(async () => {
    await memory.deleteAll({ userId: "test-user" });
  });

  it("adds a memory and finds related entities in the graph", async () => { ... });
  it("searches and returns graph relations alongside vector results", async () => { ... });
  it("deleteAll removes all nodes for a userId", async () => { ... });
});
```

---

## Implementation Steps (in order)

1. Scaffold the repo (package.json, tsconfig, jest.config, .eslintrc)
2. Install deps: `npm install falkordb` and `npm install --save-dev mem0ai typescript jest ts-jest @types/jest @types/node`
3. Implement `src/types.ts`
4. Implement `src/CypherTranslator.ts` — write tests first, then implement
5. **Read `node_modules/mem0ai/dist/oss/index.js`** — search for `MemoryGraph` class and all Cypher queries it uses. Extract every query string. This is the ground truth for what you need to handle.
6. Implement `src/FalkorDBGraph.ts`
7. Implement `src/FalkorMemoryGraph.ts` based on what you found in step 5
8. Implement `src/FalkorMemory.ts` — verify the super() strategy works by checking if mem0 connects eagerly or lazily
9. Write all unit tests
10. Run `npm test` and fix until green
11. Write `README.md` with usage example, prerequisites (FalkorDB >= 6.0), and the Cypher compatibility notes

---

## Key Files to Read Before Writing Code

- `node_modules/mem0ai/dist/oss/index.js` — search for: `MemoryGraph`, `apoc.merge`, `__Entity__`, `this.graph.query`, `_addEntities`, `_retrieveNodesFromData`
- `node_modules/falkordb/dist/` — understand the `Graph.query()` return shape and connection API
- `node_modules/mem0ai/dist/oss/index.d.ts` — understand what's exported and what types are available

---

## Success Criteria

- `npm test` passes with all unit tests green
- `CypherTranslator` correctly handles all APOC patterns mem0 uses
- `FalkorMemory` is usable as a drop-in replacement for `Memory` from `mem0ai/oss`
- No modifications to `node_modules/mem0ai/` anywhere
- The package is publishable (`npm pack` produces a valid tarball)
