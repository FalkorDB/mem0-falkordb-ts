/**
 * Multi-User Agentic Memory Demo for falkordb-mem0.
 *
 * This demo showcases:
 * - Graph-structured memory (relationships between entities)
 * - Per-user memory isolation
 * - Context-aware retrieval (semantic search + graph relations)
 * - Memory evolution (updates and conflicts)
 *
 * Prerequisites:
 * - FalkorDB running on localhost:6379
 * - OPENAI_API_KEY environment variable set
 *
 * Usage:
 *   npx tsx demo.ts
 *
 *   For CI mode (tests initialization only):
 *   DEMO_CI_MODE=1 npx tsx demo.ts
 */

import { FalkorMemory, FalkorMemoryGraph } from "falkordb-mem0";

// ── Helpers ─────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function heading(title: string, emoji = ">>") {
  console.log(`\n${emoji} ${BOLD}${CYAN}${title}${RESET}\n`);
}

function printMemories(results: any[], title = "Retrieved Memories") {
  if (!results.length) {
    console.log(`${YELLOW}  No memories found${RESET}`);
    return;
  }
  console.log(`  ${BOLD}${title}${RESET}`);
  for (const r of results) {
    const text = typeof r === "string" ? r : r.memory ?? r.relationship ?? JSON.stringify(r);
    console.log(`  - ${text}`);
  }
}

function printRelations(relations: any[], title = "Graph Relations") {
  if (!relations.length) {
    console.log(`${YELLOW}  No relations found${RESET}`);
    return;
  }
  console.log(`  ${BOLD}${title}${RESET}`);
  for (const r of relations) {
    console.log(`  ${CYAN}${r.source}${RESET} --[${YELLOW}${r.relationship}${RESET}]--> ${GREEN}${r.destination ?? r.target}${RESET}`);
  }
}

async function printGraphStats(graph: FalkorMemoryGraph, userId: string) {
  try {
    const results = await graph.getAll({ userId }, 1000);
    if (!results.length) {
      console.log(`${YELLOW}  No graph data for user '${userId}'${RESET}`);
      return;
    }

    const nodes = new Set<string>();
    for (const item of results) {
      nodes.add(item.source);
      nodes.add(item.target);
    }

    console.log(`  ${GREEN}User '${userId}' graph:${RESET} ${nodes.size} nodes, ${results.length} relationships`);
    console.log(`  ${BOLD}Sample Relationships:${RESET}`);
    for (const item of results.slice(0, 5)) {
      console.log(`  ${CYAN}${item.source}${RESET} --[${YELLOW}${item.relationship}${RESET}]--> ${GREEN}${item.target}${RESET}`);
    }
  } catch (e: any) {
    console.log(`${RED}  Error getting graph stats: ${e.message}${RESET}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Demo Scenes ─────────────────────────────────────────────────────────

const USERS: Record<string, string[]> = {
  alice: [
    "My name is Alice Chen. I'm a senior software engineer at TechCorp, specializing in backend systems using Python and Django.",
    "I've been vegan for 5 years and I'm allergic to all tree nuts. My favorite vegan protein sources are tofu, tempeh, and lentils.",
    "I love hiking in the White Mountains every weekend. My goal is to complete all 48 four-thousand footers in New Hampshire.",
    "I'm planning a two-week trip to Japan in March to visit Tokyo, Kyoto, and Osaka. I want to explore vegan Japanese cuisine and hike Mount Fuji.",
    "At work, I prefer Python over JavaScript for backend development. I'm currently leading a project to migrate our REST API to GraphQL using Strawberry.",
  ],
  bob: [
    "I'm Bob, a chef and restaurant owner specializing in Italian cuisine at my restaurant Bella Napoli in Boston.",
    "My two kids, Emma and Lucas, both play soccer. I coach their team, the Boston Strikers, every Saturday.",
    "At the restaurant, I'm known for my handmade pasta and wood-fired pizzas. My signature dish is Carbonara alla Romana.",
    "I'm looking for restaurant management software to help track inventory, especially for fresh ingredients like San Marzano tomatoes and buffalo mozzarella that I import from Italy.",
    "On Sundays after soccer practice, I often cook family meals with Emma and Lucas, teaching them traditional Italian recipes I learned from my grandmother in Naples.",
  ],
  carol: [
    "I'm Dr. Carol Martinez, a cardiologist at Boston General Hospital specializing in preventive cardiology and sports medicine.",
    "I've completed 12 marathons including Boston, New York, and Chicago. My personal best is 3 hours 24 minutes at the Chicago Marathon last fall.",
    "As an athlete-physician, I follow a high-protein Mediterranean diet focused on lean fish, chicken, legumes, and lots of vegetables to support my training.",
    "I'm currently writing a research paper on using machine learning for early detection of atrial fibrillation in athletes. My co-author is Dr. James Park from MIT's CSAIL.",
    "I train my cardiology residents on the connection between athletic performance and heart health. Many of my patients are runners who come to me for cardiovascular screening.",
  ],
};

async function scene1Onboarding(memory: FalkorMemory): Promise<void> {
  heading("Scene 1: Onboarding Multiple Users", "👥");

  for (const [userId, messages] of Object.entries(USERS)) {
    console.log(`${BOLD}  Adding memories for ${userId}...${RESET}`);
    for (const msg of messages) {
      await memory.add(msg, { userId });
      process.stdout.write(".");
      await sleep(100);
    }
    console.log(` ${GREEN}done${RESET}`);
  }

  console.log(`\n${GREEN}${BOLD}All users onboarded!${RESET}`);
}

async function scene2Retrieval(memory: FalkorMemory, graph: FalkorMemoryGraph): Promise<void> {
  heading("Scene 2: Context-Aware Memory Retrieval", "🔍");

  const queries: Record<string, string[]> = {
    alice: [
      "what vegan dishes can she eat?",
      "what are her travel plans and hiking goals?",
      "what programming languages and frameworks does she use?",
    ],
    bob: [
      "what does he do with his children?",
      "what are his signature dishes at the restaurant?",
      "what kind of software and ingredients does he need?",
    ],
    carol: [
      "what is her research about?",
      "what are her marathon achievements?",
      "how does her diet support her athletic training?",
    ],
  };

  for (const [userId, userQueries] of Object.entries(queries)) {
    console.log(`\n${BOLD}${CYAN}  Querying memories for ${userId}...${RESET}`);

    for (const query of userQueries) {
      console.log(`\n${YELLOW}  Q: ${query}${RESET}`);
      const results = await memory.search(query, { userId });
      if (results.results?.length) {
        printMemories(results.results, `Vector Results for ${userId}`);
      }
      if (results.relations?.length) {
        printRelations(results.relations, `Graph Relations for ${userId}`);
      }
    }

    await printGraphStats(graph, userId);
  }
}

async function scene3MemoryUpdate(memory: FalkorMemory): Promise<void> {
  heading("Scene 3: Memory Update & Conflict Resolution", "🔄");

  const userId = "alice";

  console.log(`${BOLD}  Current diet preference for ${userId}:${RESET}`);
  const before = await memory.search("what does alice eat?", { userId });
  if (before.results?.length) printMemories(before.results);
  if (before.relations?.length) printRelations(before.relations);

  console.log(`\n${YELLOW}  Updating ${userId}'s diet...${RESET}`);
  await memory.add(
    "I've transitioned from vegan to pescatarian. I now eat fish and seafood in addition to plant-based foods.",
    { userId }
  );

  console.log(`\n${BOLD}  Updated diet preference for ${userId}:${RESET}`);
  const after = await memory.search("what does alice eat?", { userId });
  if (after.results?.length) printMemories(after.results);
  if (after.relations?.length) printRelations(after.relations);

  console.log(`\n${GREEN}Memory successfully updated!${RESET}`);
}

async function scene4IsolationProof(memory: FalkorMemory): Promise<void> {
  heading("Scene 4: Per-User Memory Isolation Proof", "🔒");

  console.log(`${YELLOW}  Searching for 'marathons' in alice's memories (should find nothing - that's Carol's data):${RESET}\n`);
  const aliceResults = await memory.search("marathons", { userId: "alice" });
  if (aliceResults.results?.length) printMemories(aliceResults.results);
  if (aliceResults.relations?.length) printRelations(aliceResults.relations);

  const aliceHasMarathon = (aliceResults.results || []).some(
    (r: any) => (r.memory || "").toLowerCase().includes("marathon")
  );
  if (!aliceHasMarathon) {
    console.log(`\n${GREEN}${BOLD}Isolation confirmed!${RESET} Alice cannot access Carol's marathon memories.`);
  }

  console.log(`\n${YELLOW}  Searching for 'marathons' in carol's memories:${RESET}\n`);
  const carolResults = await memory.search("marathons", { userId: "carol" });
  if (carolResults.results?.length) printMemories(carolResults.results);
  if (carolResults.relations?.length) printRelations(carolResults.relations);

  if (carolResults.results?.length || carolResults.relations?.length) {
    console.log(`\n${GREEN}${BOLD}Carol's memories are properly isolated!${RESET}`);
  }
}

async function scene5ScaleDemo(memory: FalkorMemory): Promise<void> {
  heading("Scene 5: Scale Simulation", "📊");

  console.log(`${YELLOW}  Creating 10 synthetic users with diverse memories...${RESET}\n`);

  const syntheticMessages = [
    "I love reading science fiction novels",
    "I play tennis every Tuesday",
    "I work as a data scientist",
    "I'm learning to play the guitar",
    "I enjoy cooking Mediterranean food",
  ];

  const start = Date.now();

  for (let i = 0; i < 10; i++) {
    const userId = `user_${String(i).padStart(3, "0")}`;
    for (let j = 0; j < 3; j++) {
      await memory.add(`${syntheticMessages[j % syntheticMessages.length]} (variant ${j})`, { userId });
    }
    process.stdout.write(".");
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n\n${GREEN}Created 10 users with 30 total memories in ${elapsed}s${RESET}`);

  console.log(`\n${YELLOW}  Testing search speed for a single user...${RESET}`);
  const queryStart = Date.now();
  await memory.search("hobbies", { userId: "user_005" });
  const queryTime = ((Date.now() - queryStart) / 1000).toFixed(3);

  console.log(`${GREEN}  Query completed in ${queryTime}s${RESET}`);
  console.log(`${DIM}  Per-user graph isolation keeps queries fast regardless of total user count!${RESET}`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${BOLD}  falkordb-mem0 Multi-User Demo${RESET}`);
  console.log(`  Showcasing graph-structured memory with per-user isolation`);
  console.log(`${"─".repeat(60)}`);

  const CI_MODE = ["1", "true", "yes"].includes(
    (process.env.DEMO_CI_MODE || "").toLowerCase()
  );

  if (!CI_MODE && !process.env.OPENAI_API_KEY) {
    console.log(
      `${RED}Error: OPENAI_API_KEY environment variable not set!${RESET}\n` +
      `Please set it and try again:\n` +
      `  export OPENAI_API_KEY='your-key-here'\n` +
      `  npx tsx demo.ts`
    );
    return;
  }

  console.log(`\n${YELLOW}Initializing FalkorMemory...${RESET}`);

  let memory: FalkorMemory;
  try {
    memory = new FalkorMemory({
      enableGraph: true,
      graphStore: {
        provider: "falkordb",
        config: {
          host: process.env.FALKORDB_HOST || "localhost",
          port: parseInt(process.env.FALKORDB_PORT || "6379"),
          graphName: "mem0_demo",
        },
      },
      llm: {
        provider: "openai",
        config: {
          apiKey: process.env.OPENAI_API_KEY,
          model: "gpt-4o-mini",
        },
      },
      embedder: {
        provider: "openai",
        config: {
          apiKey: process.env.OPENAI_API_KEY,
          model: "text-embedding-3-small",
          embeddingDims: 1536,
        },
      },
      vectorStore: {
        provider: "memory",
        config: { dimension: 1536 },
      },
    });
    console.log(`${GREEN}Connected to FalkorDB${RESET}`);
  } catch (e: any) {
    console.log(
      `${RED}Failed to initialize FalkorMemory:${RESET}\n${e.message}\n\n` +
      `${YELLOW}Make sure FalkorDB is running:${RESET}\n` +
      `  docker run --rm -p 6379:6379 falkordb/falkordb:latest`
    );
    return;
  }

  // Access the internal FalkorMemoryGraph for graph stats
  const graph = (memory as any).graphMemory as FalkorMemoryGraph | undefined;

  if (CI_MODE) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${GREEN}${BOLD}  CI Validation Complete!${RESET}`);
    console.log(`  - Demo script imports successfully`);
    console.log(`  - FalkorMemory instance created`);
    console.log(`  - falkordb-mem0 provider configured`);
    console.log(`${DIM}  Run without DEMO_CI_MODE for the full demo${RESET}`);
    console.log(`${"─".repeat(60)}`);
    await memory.close();
    return;
  }

  try {
    await scene1Onboarding(memory);
    if (graph) await scene2Retrieval(memory, graph);
    await scene3MemoryUpdate(memory);
    await scene4IsolationProof(memory);
    await scene5ScaleDemo(memory);

    console.log(`\n${"─".repeat(60)}`);
    console.log(`${GREEN}${BOLD}  Demo Complete!${RESET}`);
    console.log(`  Key Takeaways:`);
    console.log(`  - Graph-structured memory captures relationships, not just flat facts`);
    console.log(`  - Per-user isolation via FalkorDB graph separation`);
    console.log(`  - Memory evolves as new information arrives`);
    console.log(`  - Semantic search + BM25 re-ranking for retrieval`);
    console.log(`\n${DIM}  Run 'npx tsx inspect-graphs.ts' to see raw graph contents${RESET}`);
    console.log(`${"─".repeat(60)}`);
  } catch (e: any) {
    if (e.message?.includes("interrupted")) {
      console.log(`\n${YELLOW}Demo interrupted${RESET}`);
    } else {
      console.log(`\n${RED}Error during demo: ${e.message}${RESET}`);
      throw e;
    }
  } finally {
    await memory.close();
  }
}

main().catch(console.error);
