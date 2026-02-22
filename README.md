# @falkordb/mem0

FalkorDB graph store backend for the [mem0ai](https://github.com/mem0ai/mem0) TypeScript SDK.

Drop-in replacement for mem0's Neo4j-based graph memory — use `FalkorMemory` instead of `Memory` and point it at a FalkorDB instance.

## Prerequisites

- **Node.js** >= 18
- **FalkorDB** >= 6.0 ([Docker quickstart](https://docs.falkordb.com/))
- **mem0ai** >= 2.0.0 (peer dependency)

### Start FalkorDB with Docker

```bash
docker run -p 6379:6379 -it --rm falkordb/falkordb
```

## Installation

```bash
npm install @falkordb/mem0 mem0ai
```

## Quick Start

```typescript
import { FalkorMemory } from "@falkordb/mem0";

const memory = new FalkorMemory({
  enableGraph: true,
  graphStore: {
    provider: "falkordb",
    config: {
      host: "localhost",
      port: 6379,
      graphName: "mem0", // optional, defaults to "mem0"
    },
  },
  llm: {
    provider: "openai",
    config: { apiKey: process.env.OPENAI_API_KEY },
  },
  embedder: {
    provider: "openai",
    config: { apiKey: process.env.OPENAI_API_KEY },
  },
  vectorStore: {
    provider: "memory",
    config: { dimension: 1536 },
  },
});

// Add memories — entities and relationships are extracted automatically
await memory.add("Alice works at Google and loves TypeScript.", {
  userId: "alice",
});

// Search — returns vector results + graph relations
const results = await memory.search("Where does Alice work?", {
  userId: "alice",
});
console.log(results);

// Clean up
await memory.close();
```

## Configuration

### `FalkorMemoryConfig`

Extends mem0's `MemoryConfig` with FalkorDB-specific graph store options:

| Field | Type | Description |
|---|---|---|
| `graphStore.provider` | `"falkordb"` | Must be `"falkordb"` |
| `graphStore.config.host` | `string` | FalkorDB host (default: `"localhost"`) |
| `graphStore.config.port` | `number` | FalkorDB port (default: `6379`) |
| `graphStore.config.password` | `string?` | Optional auth password |
| `graphStore.config.username` | `string?` | Optional auth username |
| `graphStore.config.graphName` | `string?` | Graph name (default: `"mem0"`) |
| `graphStore.llm` | `object?` | Override LLM provider for graph operations |
| `graphStore.customPrompt` | `string?` | Custom prompt for relationship extraction |

All other fields (`llm`, `embedder`, `vectorStore`, etc.) are passed through to mem0 as-is.

## How It Works

`FalkorMemory` extends mem0's `Memory` class. When `graphStore.provider` is `"falkordb"`, it:

1. Calls `super()` with `enableGraph: false` to skip Neo4j initialization
2. Creates a `FalkorMemoryGraph` instance backed by the FalkorDB driver
3. Injects it as the internal graph memory handler

`FalkorMemoryGraph` reimplements mem0's `MemoryGraph` using the same LLM calls (entity extraction, relationship extraction, deletion decisions) and the same graph query patterns, adapted for FalkorDB.

### Cypher Compatibility

The `CypherTranslator` handles the few Cypher dialect differences between Neo4j and FalkorDB:

| Neo4j | FalkorDB | Notes |
|---|---|---|
| `elementId(n)` | `id(n)` | FalkorDB uses `id()` |
| `round(x, 4)` | `round(x)` | FalkorDB `round()` takes one argument |
| `apoc.merge.relationship(...)` | `MERGE (a)-[r:TYPE]->(b)` | Safety net (mem0 v2.x doesn't use APOC) |

Standard Cypher features used by mem0 work as-is in FalkorDB: `MERGE`, `MATCH`, `DETACH DELETE`, `timestamp()`, `reduce()`, `sqrt()`, `type(r)`, `size()`, `range()`.

## API

### `FalkorMemory`

Same API as mem0's `Memory` class, plus:

- **`close(): Promise<void>`** — Closes the FalkorDB connection. Call this when done.

### `FalkorMemoryGraph`

Can be used standalone without the vector store layer:

```typescript
import { FalkorMemoryGraph } from "@falkordb/mem0";

const graph = new FalkorMemoryGraph(config);
await graph.add("Bob likes pizza", { userId: "bob" });
const results = await graph.search("What does Bob like?", { userId: "bob" });
await graph.getAll({ userId: "bob" });
await graph.deleteAll({ userId: "bob" });
await graph.close();
```

### `FalkorDBGraph`

Low-level FalkorDB driver wrapper with automatic Cypher translation:

```typescript
import { FalkorDBGraph } from "@falkordb/mem0";

const db = new FalkorDBGraph({ host: "localhost", port: 6379 });
const rows = await db.query("MATCH (n) RETURN n.name AS name LIMIT 10");
await db.close();
```

### `CypherTranslator`

Static utility for translating Neo4j Cypher to FalkorDB-compatible Cypher:

```typescript
import { CypherTranslator } from "@falkordb/mem0";

const { query, params } = CypherTranslator.translate(
  "RETURN elementId(n) AS id",
  {}
);
// query: "RETURN id(n) AS id"
```

## Development

```bash
npm install
npm test          # Run unit tests
npm run build     # Compile TypeScript
```

### Integration Tests

Integration tests require a running FalkorDB instance:

```bash
FALKORDB_HOST=localhost OPENAI_API_KEY=sk-... npm test
```

## License

MIT
