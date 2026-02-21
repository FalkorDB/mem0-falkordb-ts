import { FalkorDB, Graph } from "falkordb";
import { CypherTranslator } from "./CypherTranslator";
import { FalkorDBConfig } from "./types";

export class FalkorDBGraph {
  private client!: FalkorDB;
  private graph!: Graph;
  private config: FalkorDBConfig;
  private initialized = false;

  constructor(config: FalkorDBConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const port = this.config.port || 6379;
    const host = this.config.host || "localhost";
    const password = this.config.password;
    const username = this.config.username;

    let url = `redis://${host}:${port}`;
    if (username && password) {
      url = `redis://${username}:${password}@${host}:${port}`;
    } else if (password) {
      url = `redis://:${password}@${host}:${port}`;
    }

    this.client = await FalkorDB.connect({ url });
    this.graph = this.client.selectGraph(
      this.config.graphName || "mem0"
    );

    this.initialized = true;
  }

  async query(
    cypher: string,
    params?: Record<string, any>
  ): Promise<any[]> {
    await this.init();

    const { query: translatedQuery, params: translatedParams } =
      CypherTranslator.translate(cypher, params || {});

    try {
      const result = await this.graph.query(translatedQuery, {
        params: translatedParams,
      });
      return result.data ?? [];
    } catch (error: any) {
      const msg = error.message || String(error);
      throw new Error(
        `FalkorDB query failed: ${msg}\nQuery: ${translatedQuery}`
      );
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
    }
  }
}
