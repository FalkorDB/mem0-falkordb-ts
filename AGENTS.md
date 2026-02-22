# Project Guidelines

## Overview
@falkordb/mem0 is a FalkorDB graph store backend for the [mem0ai](https://github.com/mem0ai/mem0) TypeScript SDK. It provides a drop-in replacement for mem0's Neo4j-based graph memory by offering a `FalkorMemory` class that uses FalkorDB as the graph store backend.

## Build & Install
```bash
npm install  # install dependencies
npm run build  # compile TypeScript
```

Or for production use:
```bash
npm install @falkordb/mem0
```

## Testing
Tests require a running FalkorDB instance on `localhost:6379`:
```bash
docker run --rm -p 6379:6379 falkordb/falkordb:edge
```

Run all tests:
```bash
npm test
```

Run tests with environment variables:
```bash
FALKORDB_HOST=localhost OPENAI_API_KEY=sk-... npm test
```

## Pre-commit Checks
Always run these checks before every commit:
```bash
npm run lint
npm run spellcheck
npm test
```

## Code Style
- **Language**: TypeScript >= 5.0
- **Runtime**: Node.js >= 18
- **Linter**: ESLint with typescript-eslint
- **Testing**: Jest with ts-jest
- **Package manager**: npm

## Project Structure
```
src/
  index.ts              # Main entry point — exports FalkorMemory, FalkorMemoryGraph, FalkorDBGraph, CypherTranslator
  types.ts              # TypeScript type definitions for FalkorDB configs
  FalkorMemory.ts       # FalkorMemory — main class extending mem0's Memory
  FalkorMemoryGraph.ts  # FalkorMemoryGraph — reimplements mem0's MemoryGraph for FalkorDB
  FalkorDBGraph.ts      # FalkorDBGraph — low-level FalkorDB driver wrapper with Cypher translation
  CypherTranslator.ts   # CypherTranslator — translates Neo4j Cypher to FalkorDB-compatible Cypher

tests/
  CypherTranslator.test.ts              # Cypher translation unit tests
  FalkorDBGraph.test.ts                 # FalkorDBGraph unit tests
  FalkorMemory.integration.test.ts     # End-to-end integration tests (requires FalkorDB instance)
```

## Architecture Patterns

### Extension Pattern
Unlike the Python version which uses runtime patching, the TypeScript implementation uses class extension:
1. `FalkorMemory` extends mem0's `Memory` class
2. When `graphStore.provider` is `"falkordb"`, it calls `super()` with `enableGraph: false` to skip Neo4j initialization
3. Creates a `FalkorMemoryGraph` instance and injects it as the internal graph memory handler
4. No modification of mem0 source code required

### Per-User Graph Isolation
Each user automatically gets their own isolated FalkorDB graph (e.g., `mem0_alice`, `mem0_bob`):
- Graph name format: `{graphName}_{userId}` (where `graphName` defaults to `"mem0"`)
- Leverages FalkorDB's native multi-graph support
- No user_id filtering needed in Cypher queries
- Simple cleanup: `deleteAll` drops the user's graph

### Key Cypher Translations
FalkorDB uses different Cypher syntax compared to Neo4j:
| Neo4j | FalkorDB | Notes |
|-------|----------|-------|
| `elementId(n)` | `id(n)` | FalkorDB uses numeric IDs |
| `round(x, 4)` | `round(x)` | FalkorDB `round()` takes one argument |
| `apoc.merge.relationship(...)` | `MERGE (a)-[r:TYPE]->(b)` | Safety net (mem0 v2.x doesn't use APOC) |

Standard Cypher features work as-is: `MERGE`, `MATCH`, `DETACH DELETE`, `timestamp()`, `reduce()`, `sqrt()`, `type(r)`, `size()`, `range()`.

### Important Implementation Notes
- **FalkorDB driver**: Uses the `falkordb` npm package (v6.0.0+)
- **Result parsing**: FalkorDB returns results differently than Neo4j; careful parsing is required
- **Async/await**: All database operations are async and use TypeScript's async/await
- **Error handling**: Gracefully handles connection errors and query failures
- **Resource cleanup**: Always call `close()` to properly close database connections

## CI/CD
- **GitHub Actions workflows**:
  - Dependencies: Dependabot for npm dependency updates
  - Spellcheck: Runs cspell on push/PR to main branch
  - Testing: (Add test workflow as needed)
  - Linting: (Add lint workflow as needed)
  - Build: (Add build workflow as needed)
  - Publish: (Add publish workflow for npm as needed)

## Before Finishing a Task
After completing any task, review whether your changes require updates to:
- **`README.md`** — if public API, usage examples, or installation instructions changed
- **`AGENTS.md`** — if project structure, build commands, architecture patterns, or conventions changed
- **`package.json`** — if dependencies, scripts, or package metadata changed
