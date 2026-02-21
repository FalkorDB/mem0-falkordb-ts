import { Memory } from "mem0ai/oss";
import { FalkorMemoryGraph } from "./FalkorMemoryGraph";
import { FalkorMemoryConfig } from "./types";

export class FalkorMemory extends Memory {
  private falkorMemoryGraph?: FalkorMemoryGraph;

  constructor(config: FalkorMemoryConfig) {
    if (config.graphStore?.provider !== "falkordb") {
      // Pass through to normal Memory for non-falkordb configs
      super(config as any);
      return;
    }

    // Pass enableGraph: false to super() to prevent mem0 from trying to
    // create a Neo4j-backed MemoryGraph. We'll set up our own graph after.
    super({
      ...config,
      enableGraph: false,
      graphStore: undefined,
    } as any);

    // Now manually wire up the FalkorDB-backed graph memory
    const falkorGraph = new FalkorMemoryGraph(config);
    this.falkorMemoryGraph = falkorGraph;
    (this as any).enableGraph = true;
    (this as any).graphMemory = falkorGraph;
  }

  /**
   * Close the FalkorDB connection when done.
   */
  async close(): Promise<void> {
    if (this.falkorMemoryGraph) {
      await this.falkorMemoryGraph.close();
    }
  }
}
