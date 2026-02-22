# @falkordb/mem0 Multi-User Demo

Interactive demo showcasing **graph-structured memory** with per-user isolation using `@falkordb/mem0`.

## Features Demonstrated

| Scene | What it shows |
|-------|---------------|
| 1. Onboarding | Add memories for 3 users (Alice, Bob, Carol) with distinct profiles |
| 2. Retrieval | Semantic search + graph relations scoped to each user |
| 3. Memory Update | Evolve a user's preferences (vegan → pescatarian) |
| 4. Isolation Proof | Verify users cannot see each other's memories |
| 5. Scale Simulation | Create 10 synthetic users and benchmark query speed |

## Prerequisites

- **Docker** (for FalkorDB)
- **Node.js** 18+
- **OpenAI API key**

## Quick Start

### 1. Start FalkorDB

```bash
docker run --rm -p 6379:6379 falkordb/falkordb:latest
```

### 2. Install dependencies

```bash
cd demo
npm install
```

### 3. Set your API key

```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
export $(cat .env | xargs)
```

### 4. Run the demo

```bash
npx tsx demo.ts
```

### 5. Inspect the graphs

After running the demo, view the raw FalkorDB graph structure:

```bash
npx tsx inspect-graphs.ts
```

## What You'll See

### Demo Output

The demo creates three user profiles with rich, interconnected memories:

- **Alice** — Software engineer, vegan/pescatarian, hiker, Japan travel plans
- **Bob** — Italian chef, restaurant owner, soccer dad
- **Carol** — Cardiologist, marathon runner, ML researcher

Each user's memories are stored in a separate FalkorDB graph, with entities as nodes and their relationships as edges.

### Graph Inspector Output

The inspector connects directly to FalkorDB and displays:

- **Nodes** — Entities with names (people, places, concepts)
- **Relationships** — How entities connect (e.g., `Alice --[SPECIALIZES_IN]--> Python`)
- **Tree visualization** — Compact graph structure preview

## Configuration

| Setting | Value |
|---------|-------|
| FalkorDB | `localhost:6379` (configurable via `FALKORDB_HOST` / `FALKORDB_PORT`) |
| LLM | OpenAI `gpt-4o-mini` |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions) |
| Vector Store | In-memory (demo only) |
| Graph prefix | `mem0` (each user gets `mem0_{userId}`) |

## CI Mode

For automated testing, run in CI mode (skips LLM calls, validates initialization only):

```bash
DEMO_CI_MODE=1 npx tsx demo.ts
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Failed to connect to FalkorDB` | Make sure Docker is running: `docker run --rm -p 6379:6379 falkordb/falkordb:latest` |
| `OPENAI_API_KEY not set` | Export your key: `export OPENAI_API_KEY='sk-...'` |
| `No mem0 graphs found` (inspector) | Run `npx tsx demo.ts` first to create memories |

## Cleanup

Stop FalkorDB to remove all data:

```bash
docker stop $(docker ps -q --filter ancestor=falkordb/falkordb:latest)
```
