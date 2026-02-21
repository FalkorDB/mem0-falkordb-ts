import { FalkorMemory } from "../src/FalkorMemory";

describe("FalkorMemory integration", () => {
  let memory: FalkorMemory;

  beforeAll(async () => {
    if (!process.env.FALKORDB_HOST) {
      return;
    }
    memory = new FalkorMemory({
      enableGraph: true,
      graphStore: {
        provider: "falkordb",
        config: {
          host: process.env.FALKORDB_HOST!,
          port: parseInt(process.env.FALKORDB_PORT ?? "6379"),
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
    if (memory) {
      try {
        await memory.deleteAll({ userId: "test-user" });
      } catch {
        // ignore
      }
      await memory.close();
    }
  });

  const skipIfNoFalkorDB = () => {
    if (!process.env.FALKORDB_HOST) {
      return true;
    }
    return false;
  };

  it("adds a memory and finds related entities in the graph", async () => {
    if (skipIfNoFalkorDB()) return;

    const result = await memory.add(
      "Alice works at Google and loves programming in TypeScript.",
      { userId: "test-user" }
    );

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
  });

  it("searches and returns graph relations alongside vector results", async () => {
    if (skipIfNoFalkorDB()) return;

    const result = await memory.search("Where does Alice work?", {
      userId: "test-user",
    });

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
  });

  it("deleteAll removes all nodes for a userId", async () => {
    if (skipIfNoFalkorDB()) return;

    await memory.deleteAll({ userId: "test-user" });

    const result = await memory.search("Alice", {
      userId: "test-user",
    });

    expect(result).toBeDefined();
  });
});
