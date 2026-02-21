export interface FalkorDBConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  graphName?: string;
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

export interface FalkorMemoryConfig {
  version?: string;
  embedder: { provider: string; config: Record<string, any> };
  vectorStore: { provider: string; config: Record<string, any> };
  llm: { provider: string; config: Record<string, any> };
  historyStore?: { provider: string; config: Record<string, any> };
  disableHistory?: boolean;
  historyDbPath?: string;
  customPrompt?: string;
  enableGraph?: boolean;
  graphStore?: FalkorGraphStoreConfig;
}
