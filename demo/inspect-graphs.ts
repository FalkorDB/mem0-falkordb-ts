/**
 * Graph inspector for @falkordb/mem0.
 *
 * Connects directly to FalkorDB and displays the raw graph structure
 * for each user's memory graph. Useful for understanding how memories
 * are stored as nodes and relationships.
 *
 * Prerequisites:
 * - FalkorDB running on localhost:6379
 * - At least one user's memories created (run demo.ts first)
 *
 * Usage:
 *   npx tsx inspect-graphs.ts
 */

import { FalkorDB } from "falkordb";

// ── Helpers ─────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ── Functions ───────────────────────────────────────────────────────────

async function getAllMem0Graphs(
  db: FalkorDB,
  prefix = "mem0"
): Promise<string[]> {
  const allGraphs = await db.list();
  return allGraphs.filter((g: string) => g.startsWith(`${prefix}_`));
}

function extractUserId(graphName: string, prefix = "mem0"): string {
  const p = `${prefix}_`;
  return graphName.startsWith(p) ? graphName.slice(p.length) : graphName;
}

async function getGraphNodes(
  db: FalkorDB,
  graphName: string,
  limit = 100
): Promise<any[]> {
  const graph = db.selectGraph(graphName);
  const result = await graph.query<{
    id: number;
    name: string;
    labels: string[];
  }>(
    `MATCH (n) RETURN id(n) AS id, n.name AS name LIMIT ${limit}`
  );
  return result.data ?? [];
}

async function getGraphRelationships(
  db: FalkorDB,
  graphName: string,
  limit = 100
): Promise<any[]> {
  const graph = db.selectGraph(graphName);
  const result = await graph.query<{
    source: string;
    relationship: string;
    target: string;
  }>(
    `MATCH (a)-[r]->(b)
     RETURN a.name AS source, type(r) AS relationship, b.name AS target
     LIMIT ${limit}`
  );
  return result.data ?? [];
}

async function displayUserGraph(
  db: FalkorDB,
  graphName: string,
  userId: string
): Promise<void> {
  console.log(`\n${BOLD}${CYAN}User: ${userId}${RESET}`);
  console.log(`${DIM}Graph: ${graphName}${RESET}\n`);

  const nodes = await getGraphNodes(db, graphName);
  const relationships = await getGraphRelationships(db, graphName);

  if (!nodes.length && !relationships.length) {
    console.log(`${YELLOW}  Empty graph - no data${RESET}`);
    return;
  }

  console.log(`${GREEN}  Nodes:${RESET} ${nodes.length}`);
  console.log(`${GREEN}  Relationships:${RESET} ${relationships.length}\n`);

  // Display nodes
  if (nodes.length) {
    console.log(`  ${BOLD}Nodes in ${userId}'s Graph:${RESET}`);
    console.log(`  ${"─".repeat(40)}`);
    for (const node of nodes.slice(0, 20)) {
      const name = node.name ?? "(unnamed)";
      console.log(`  ${CYAN}[${node.id}]${RESET} ${name}`);
    }
    if (nodes.length > 20) {
      console.log(`  ${DIM}... and ${nodes.length - 20} more${RESET}`);
    }
  }

  // Display relationships
  if (relationships.length) {
    console.log(`\n  ${BOLD}Relationships in ${userId}'s Graph:${RESET}`);
    console.log(`  ${"─".repeat(40)}`);
    for (const rel of relationships.slice(0, 20)) {
      console.log(
        `  ${CYAN}${rel.source}${RESET} --[${YELLOW}${rel.relationship}${RESET}]--> ${GREEN}${rel.target}${RESET}`
      );
    }
    if (relationships.length > 20) {
      console.log(
        `  ${DIM}... and ${relationships.length - 20} more${RESET}`
      );
    }
  }

  // Tree visualization
  if (relationships.length) {
    console.log(`\n  ${BOLD}Graph Structure Preview:${RESET}`);

    const relBySource: Record<string, any[]> = {};
    for (const rel of relationships.slice(0, 10)) {
      const src = rel.source ?? "?";
      if (!relBySource[src]) relBySource[src] = [];
      relBySource[src].push(rel);
    }

    for (const [source, rels] of Object.entries(relBySource).slice(0, 5)) {
      console.log(`  ${CYAN}${source}${RESET}`);
      for (const rel of rels.slice(0, 3)) {
        console.log(
          `    └── [${YELLOW}${rel.relationship}${RESET}] --> ${GREEN}${rel.target}${RESET}`
        );
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${BOLD}  @falkordb/mem0 Graph Inspector${RESET}`);
  console.log(`  View raw graph structure for each user's memory`);
  console.log(`${"─".repeat(60)}`);

  let db: FalkorDB;
  try {
    const host = process.env.FALKORDB_HOST || "localhost";
    const port = parseInt(process.env.FALKORDB_PORT || "6379");
    db = await FalkorDB.connect({ url: `redis://${host}:${port}` });
    console.log(`\n${GREEN}Connected to FalkorDB${RESET}`);
  } catch (e: any) {
    console.log(
      `${RED}Failed to connect to FalkorDB:${RESET}\n${e.message}\n\n` +
        `${YELLOW}Make sure FalkorDB is running:${RESET}\n` +
        `  docker run --rm -p 6379:6379 falkordb/falkordb:latest`
    );
    return;
  }

  const mem0Graphs = await getAllMem0Graphs(db);

  if (!mem0Graphs.length) {
    console.log(
      `\n${YELLOW}No mem0 graphs found!${RESET}\n` +
        `Run 'npx tsx demo.ts' first to create some user memories.`
    );
    await db.close();
    return;
  }

  console.log(`\n${CYAN}Found ${mem0Graphs.length} user graph(s):${RESET}`);
  for (const graphName of mem0Graphs) {
    const userId = extractUserId(graphName);
    console.log(`  - ${graphName} (${BOLD}${userId}${RESET})`);
  }

  for (const graphName of mem0Graphs) {
    const userId = extractUserId(graphName);
    await displayUserGraph(db, graphName, userId);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${GREEN}${BOLD}  Inspection Complete!${RESET}`);
  console.log(`  Key Observations:`);
  console.log(`  - Each user has a separate FalkorDB graph`);
  console.log(`  - Nodes represent entities (people, places, concepts)`);
  console.log(`  - Relationships show how entities are connected`);
  console.log(`  - Properties store metadata (created, embeddings)`);
  console.log(`\n${DIM}  This is the power of graph-structured memory!${RESET}`);
  console.log(`${"─".repeat(60)}`);

  await db.close();
}

main().catch(console.error);
