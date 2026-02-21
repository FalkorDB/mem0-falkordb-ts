import {
  EmbedderFactory,
  LLMFactory,
  type Embedder,
  type LLM,
  type LLMResponse,
} from "mem0ai/oss";
import { FalkorDBGraph } from "./FalkorDBGraph";
import { FalkorMemoryConfig } from "./types";

// ── LLM Tool Definitions (mirroring mem0's internal tools) ──────────────

const EXTRACT_ENTITIES_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_entities",
    description: "Extract entities and their types from the text.",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entity: {
                type: "string",
                description: "The name or identifier of the entity.",
              },
              entity_type: {
                type: "string",
                description: "The type or category of the entity.",
              },
            },
            required: ["entity", "entity_type"],
            additionalProperties: false,
          },
          description: "An array of entities with their types.",
        },
      },
      required: ["entities"],
      additionalProperties: false,
    },
  },
};

const RELATIONS_TOOL = {
  type: "function" as const,
  function: {
    name: "establish_relationships",
    description:
      "Establish relationships among the entities based on the provided text.",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
                description: "The source entity of the relationship.",
              },
              relationship: {
                type: "string",
                description:
                  "The relationship between the source and destination entities.",
              },
              destination: {
                type: "string",
                description: "The destination entity of the relationship.",
              },
            },
            required: ["source", "relationship", "destination"],
            additionalProperties: false,
          },
        },
      },
      required: ["entities"],
      additionalProperties: false,
    },
  },
};

const DELETE_MEMORY_TOOL_GRAPH = {
  type: "function" as const,
  function: {
    name: "delete_graph_memory",
    description: "Delete the relationship between two nodes.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "The identifier of the source node in the relationship.",
        },
        relationship: {
          type: "string",
          description:
            "The existing relationship between the source and destination nodes that needs to be deleted.",
        },
        destination: {
          type: "string",
          description:
            "The identifier of the destination node in the relationship.",
        },
      },
      required: ["source", "relationship", "destination"],
      additionalProperties: false,
    },
  },
};

// ── Prompts (mirroring mem0's internal prompts) ─────────────────────────

const EXTRACT_RELATIONS_PROMPT = `
You are an advanced algorithm designed to extract structured information from text to construct knowledge graphs. Your goal is to capture comprehensive and accurate information. Follow these key principles:

1. Extract only explicitly stated information from the text.
2. Establish relationships among the entities provided.
3. Use "USER_ID" as the source entity for any self-references (e.g., "I," "me," "my," etc.) in user messages.
CUSTOM_PROMPT

Relationships:
    - Use consistent, general, and timeless relationship types.
    - Example: Prefer "professor" over "became_professor."
    - Relationships should only be established among the entities explicitly mentioned in the user message.

Entity Consistency:
    - Ensure that relationships are coherent and logically align with the context of the message.
    - Maintain consistent naming for entities across the extracted data.

Strive to construct a coherent and easily understandable knowledge graph by eshtablishing all the relationships among the entities and adherence to the user's context.

Adhere strictly to these guidelines to ensure high-quality knowledge graph extraction.
`;

const DELETE_RELATIONS_SYSTEM_PROMPT = `
You are a graph memory manager specializing in identifying, managing, and optimizing relationships within graph-based memories. Your primary task is to analyze a list of existing relationships and determine which ones should be deleted based on the new information provided.
Input:
1. Existing Graph Memories: A list of current graph memories, each containing source, relationship, and destination information.
2. New Text: The new information to be integrated into the existing graph structure.
3. Use "USER_ID" as node for any self-references (e.g., "I," "me," "my," etc.) in user messages.

Guidelines:
1. Identification: Use the new information to evaluate existing relationships in the memory graph.
2. Deletion Criteria: Delete a relationship only if it meets at least one of these conditions:
   - Outdated or Inaccurate: The new information is more recent or accurate.
   - Contradictory: The new information conflicts with or negates the existing information.
3. DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes.
4. Comprehensive Analysis:
   - Thoroughly examine each existing relationship against the new information and delete as necessary.
   - Multiple deletions may be required based on the new information.
5. Semantic Integrity:
   - Ensure that deletions maintain or improve the overall semantic structure of the graph.
   - Avoid deleting relationships that are NOT contradictory/outdated to the new information.
6. Temporal Awareness: Prioritize recency when timestamps are available.
7. Necessity Principle: Only DELETE relationships that must be deleted and are contradictory/outdated to the new information to maintain an accurate and coherent memory graph.

Note: DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes.

For example:
Existing Memory: alice -- loves_to_eat -- pizza
New Information: Alice also loves to eat burger.

Do not delete in the above example because there is a possibility that Alice loves to eat both pizza and burger.

Memory Format:
source -- relationship -- destination

Provide a list of deletion instructions, each specifying the relationship to be deleted.
`;

// ── BM25 (reimplemented from mem0's internal class) ─────────────────────

class BM25 {
  private documents: string[][];
  private k1: number;
  private b: number;
  private docLengths: number[];
  private avgDocLength: number;
  private docFreq: Map<string, number>;
  private idf: Map<string, number>;

  constructor(documents: string[][], k1 = 1.5, b = 0.75) {
    this.documents = documents;
    this.k1 = k1;
    this.b = b;
    this.docLengths = documents.map((doc) => doc.length);
    this.avgDocLength =
      this.docLengths.reduce((a, b2) => a + b2, 0) / documents.length;
    this.docFreq = new Map();
    this.idf = new Map();
    this.computeIdf();
  }

  private computeIdf(): void {
    const N = this.documents.length;
    for (const doc of this.documents) {
      const terms = new Set(doc);
      for (const term of terms) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
      }
    }
    for (const [term, freq] of this.docFreq) {
      this.idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }
  }

  private score(query: string[], doc: string[], index: number): number {
    let score = 0;
    const docLength = this.docLengths[index];
    for (const term of query) {
      const tf = doc.filter((t) => t === term).length;
      const idf = this.idf.get(term) || 0;
      score +=
        (idf * tf * (this.k1 + 1)) /
        (tf +
          this.k1 *
            (1 - this.b + (this.b * docLength) / this.avgDocLength));
    }
    return score;
  }

  search(query: string[]): string[][] {
    const scores = this.documents.map((doc, idx) => ({
      doc,
      score: this.score(query, doc, idx),
    }));
    return scores.sort((a, b) => b.score - a.score).map((item) => item.doc);
  }
}

// ── FalkorMemoryGraph ───────────────────────────────────────────────────

interface EntityTriple {
  source: string;
  relationship: string;
  destination: string;
}

interface SearchOutputItem {
  source: string;
  source_id: string;
  relationship: string;
  relation_id: string;
  destination: string;
  destination_id: string;
  similarity: number;
}

export class FalkorMemoryGraph {
  private config: FalkorMemoryConfig;
  private graph: FalkorDBGraph;
  private embeddingModel: Embedder;
  private llm: LLM;
  private structuredLlm: LLM;
  private threshold: number;

  constructor(config: FalkorMemoryConfig) {
    this.config = config;

    if (!config.graphStore?.config) {
      throw new Error("FalkorDB configuration is missing");
    }

    this.graph = new FalkorDBGraph(config.graphStore.config);

    this.embeddingModel = EmbedderFactory.create(
      config.embedder.provider,
      config.embedder.config
    );

    let llmProvider = "openai";
    if (config.llm?.provider) {
      llmProvider = config.llm.provider;
    }
    if (config.graphStore?.llm?.provider) {
      llmProvider = config.graphStore.llm.provider;
    }

    this.llm = LLMFactory.create(llmProvider, config.llm.config);
    this.structuredLlm = LLMFactory.create(llmProvider, config.llm.config);
    this.threshold = 0.7;
  }

  async add(
    data: string,
    filters: Record<string, any>
  ): Promise<{
    deleted_entities: any[];
    added_entities: any[];
    relations: EntityTriple[];
  }> {
    const entityTypeMap = await this._retrieveNodesFromData(data, filters);
    const toBeAdded = await this._establishNodesRelationsFromData(
      data,
      filters,
      entityTypeMap
    );
    const searchOutput = await this._searchGraphDb(
      Object.keys(entityTypeMap),
      filters
    );
    const toBeDeleted = await this._getDeleteEntitiesFromSearchOutput(
      searchOutput,
      data,
      filters
    );
    const deletedEntities = await this._deleteEntities(
      toBeDeleted,
      filters["userId"]
    );
    const addedEntities = await this._addEntities(
      toBeAdded,
      filters["userId"],
      entityTypeMap
    );
    return {
      deleted_entities: deletedEntities,
      added_entities: addedEntities,
      relations: toBeAdded,
    };
  }

  async search(
    query: string,
    filters: Record<string, any>,
    limit = 100
  ): Promise<EntityTriple[]> {
    const entityTypeMap = await this._retrieveNodesFromData(query, filters);
    const searchOutput = await this._searchGraphDb(
      Object.keys(entityTypeMap),
      filters,
      limit
    );
    if (!searchOutput.length) return [];

    const searchOutputsSequence = searchOutput.map((item) => [
      item.source,
      item.relationship,
      item.destination,
    ]);
    const bm25 = new BM25(searchOutputsSequence);
    const tokenizedQuery = query.split(" ");
    const rerankedResults = bm25.search(tokenizedQuery).slice(0, 5);
    return rerankedResults.map((item) => ({
      source: item[0],
      relationship: item[1],
      destination: item[2],
    }));
  }

  async deleteAll(filters: Record<string, any>): Promise<void> {
    await this.graph.query("MATCH (n {user_id: $user_id}) DETACH DELETE n", {
      user_id: filters["userId"],
    });
  }

  async getAll(
    filters: Record<string, any>,
    limit = 100
  ): Promise<any[]> {
    const result = await this.graph.query(
      `
      MATCH (n {user_id: $user_id})-[r]->(m {user_id: $user_id})
      RETURN n.name AS source, type(r) AS relationship, m.name AS target
      LIMIT $limit
      `,
      { user_id: filters["userId"], limit: Math.floor(Number(limit)) }
    );
    return result.map((record: any) => ({
      source: record.source,
      relationship: record.relationship,
      target: record.target,
    }));
  }

  async close(): Promise<void> {
    await this.graph.close();
  }

  // ── Private methods ─────────────────────────────────────────────────

  private async _retrieveNodesFromData(
    data: string,
    filters: Record<string, any>
  ): Promise<Record<string, string>> {
    const tools = [EXTRACT_ENTITIES_TOOL];
    const searchResults = await this.structuredLlm.generateResponse(
      [
        {
          role: "system",
          content: `You are a smart assistant who understands entities and their types in a given text. If user message contains self reference such as 'I', 'me', 'my' etc. then use ${filters["userId"]} as the source entity. Extract all the entities from the text. ***DO NOT*** answer the question itself if the given text is a question.`,
        },
        { role: "user", content: data },
      ],
      { type: "json_object" },
      tools
    );

    let entityTypeMap: Record<string, string> = {};
    try {
      if (typeof searchResults !== "string" && (searchResults as LLMResponse).toolCalls) {
        for (const call of (searchResults as LLMResponse).toolCalls!) {
          if (call.name === "extract_entities") {
            const args = JSON.parse(call.arguments);
            for (const item of args.entities) {
              entityTypeMap[item.entity] = item.entity_type;
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error in entity extraction: ${e}`);
    }

    entityTypeMap = Object.fromEntries(
      Object.entries(entityTypeMap).map(([k, v]) => [
        k.toLowerCase().replace(/ /g, "_"),
        (v as string).toLowerCase().replace(/ /g, "_"),
      ])
    );
    return entityTypeMap;
  }

  private async _establishNodesRelationsFromData(
    data: string,
    filters: Record<string, any>,
    entityTypeMap: Record<string, string>
  ): Promise<EntityTriple[]> {
    let messages;
    if (this.config.graphStore?.customPrompt) {
      messages = [
        {
          role: "system",
          content:
            EXTRACT_RELATIONS_PROMPT.replace("USER_ID", filters["userId"])
              .replace(
                "CUSTOM_PROMPT",
                `4. ${this.config.graphStore.customPrompt}`
              ) + "\nPlease provide your response in JSON format.",
        },
        { role: "user", content: data },
      ];
    } else {
      messages = [
        {
          role: "system",
          content:
            EXTRACT_RELATIONS_PROMPT.replace("USER_ID", filters["userId"]) +
            "\nPlease provide your response in JSON format.",
        },
        {
          role: "user",
          content: `List of entities: ${Object.keys(entityTypeMap)}. \n\nText: ${data}`,
        },
      ];
    }

    const tools = [RELATIONS_TOOL];
    const extractedEntities = await this.structuredLlm.generateResponse(
      messages,
      { type: "json_object" },
      tools
    );

    let entities: EntityTriple[] = [];
    if (
      typeof extractedEntities !== "string" &&
      (extractedEntities as LLMResponse).toolCalls
    ) {
      const toolCall = (extractedEntities as LLMResponse).toolCalls![0];
      if (toolCall && toolCall.arguments) {
        const args = JSON.parse(toolCall.arguments);
        entities = args.entities || [];
      }
    }

    entities = this._removeSpacesFromEntities(entities);
    return entities;
  }

  private async _searchGraphDb(
    nodeList: string[],
    filters: Record<string, any>,
    limit = 100
  ): Promise<SearchOutputItem[]> {
    const resultRelations: SearchOutputItem[] = [];

    for (const node of nodeList) {
      const nEmbedding = await this.embeddingModel.embed(node);
      // FalkorDB-adapted cosine similarity query using id() instead of elementId()
      // and round(x) instead of round(x, 4)
      const cypher = `
        MATCH (n)
        WHERE n.embedding IS NOT NULL AND n.user_id = $user_id
        WITH n,
            round(reduce(dot = 0.0, i IN range(0, size(n.embedding)-1) | dot + n.embedding[i] * $n_embedding[i]) /
            (sqrt(reduce(l2 = 0.0, i IN range(0, size(n.embedding)-1) | l2 + n.embedding[i] * n.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($n_embedding)-1) | l2 + $n_embedding[i] * $n_embedding[i]))), 4) AS similarity
        WHERE similarity >= $threshold
        MATCH (n)-[r]->(m)
        RETURN n.name AS source, elementId(n) AS source_id, type(r) AS relationship, elementId(r) AS relation_id, m.name AS destination, elementId(m) AS destination_id, similarity
        UNION
        MATCH (n)
        WHERE n.embedding IS NOT NULL AND n.user_id = $user_id
        WITH n,
            round(reduce(dot = 0.0, i IN range(0, size(n.embedding)-1) | dot + n.embedding[i] * $n_embedding[i]) /
            (sqrt(reduce(l2 = 0.0, i IN range(0, size(n.embedding)-1) | l2 + n.embedding[i] * n.embedding[i])) *
            sqrt(reduce(l2 = 0.0, i IN range(0, size($n_embedding)-1) | l2 + $n_embedding[i] * $n_embedding[i]))), 4) AS similarity
        WHERE similarity >= $threshold
        MATCH (m)-[r]->(n)
        RETURN m.name AS source, elementId(m) AS source_id, type(r) AS relationship, elementId(r) AS relation_id, n.name AS destination, elementId(n) AS destination_id, similarity
        ORDER BY similarity DESC
        LIMIT $limit
      `;

      const result = await this.graph.query(cypher, {
        n_embedding: nEmbedding,
        threshold: this.threshold,
        user_id: filters["userId"],
        limit: Math.floor(Number(limit)),
      });

      resultRelations.push(
        ...result.map((record: any) => ({
          source: record.source,
          source_id: String(record.source_id),
          relationship: record.relationship,
          relation_id: String(record.relation_id),
          destination: record.destination,
          destination_id: String(record.destination_id),
          similarity: record.similarity,
        }))
      );
    }

    return resultRelations;
  }

  private async _getDeleteEntitiesFromSearchOutput(
    searchOutput: SearchOutputItem[],
    data: string,
    filters: Record<string, any>
  ): Promise<EntityTriple[]> {
    const searchOutputString = searchOutput
      .map(
        (item) =>
          `${item.source} -- ${item.relationship} -- ${item.destination}`
      )
      .join("\n");

    const systemPrompt = DELETE_RELATIONS_SYSTEM_PROMPT.replace(
      "USER_ID",
      filters["userId"]
    );
    const userPrompt = `Here are the existing memories: ${searchOutputString} \n\n New Information: ${data}`;

    const tools = [DELETE_MEMORY_TOOL_GRAPH];
    const memoryUpdates = await this.structuredLlm.generateResponse(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { type: "json_object" },
      tools
    );

    const toBeDeleted: EntityTriple[] = [];
    if (
      typeof memoryUpdates !== "string" &&
      (memoryUpdates as LLMResponse).toolCalls
    ) {
      for (const item of (memoryUpdates as LLMResponse).toolCalls!) {
        if (item.name === "delete_graph_memory") {
          toBeDeleted.push(JSON.parse(item.arguments));
        }
      }
    }

    return this._removeSpacesFromEntities(toBeDeleted);
  }

  private async _deleteEntities(
    toBeDeleted: EntityTriple[],
    userId: string
  ): Promise<any[]> {
    const results: any[] = [];
    for (const item of toBeDeleted) {
      const { source, destination, relationship } = item;
      const cypher = `
        MATCH (n {name: $source_name, user_id: $user_id})
        -[r:${relationship}]->
        (m {name: $dest_name, user_id: $user_id})
        DELETE r
        RETURN
            n.name AS source,
            m.name AS target,
            type(r) AS relationship
      `;
      const result = await this.graph.query(cypher, {
        source_name: source,
        dest_name: destination,
        user_id: userId,
      });
      results.push(result);
    }
    return results;
  }

  private async _addEntities(
    toBeAdded: EntityTriple[],
    userId: string,
    entityTypeMap: Record<string, string>
  ): Promise<any[]> {
    const results: any[] = [];

    for (const item of toBeAdded) {
      const { source, destination, relationship } = item;
      const sourceType = entityTypeMap[source] || "unknown";
      const destinationType = entityTypeMap[destination] || "unknown";
      const sourceEmbedding = await this.embeddingModel.embed(source);
      const destEmbedding = await this.embeddingModel.embed(destination);

      const sourceNodeSearchResult = await this._searchSourceNode(
        sourceEmbedding,
        userId
      );
      const destinationNodeSearchResult = await this._searchDestinationNode(
        destEmbedding,
        userId
      );

      let cypher: string;
      let params: Record<string, any>;

      if (
        destinationNodeSearchResult.length === 0 &&
        sourceNodeSearchResult.length > 0
      ) {
        // Source exists, destination is new
        cypher = `
          MATCH (source)
          WHERE id(source) = $source_id
          MERGE (destination:${destinationType} {name: $destination_name, user_id: $user_id})
          ON CREATE SET
              destination.created = timestamp(),
              destination.embedding = $destination_embedding
          MERGE (source)-[r:${relationship}]->(destination)
          ON CREATE SET
              r.created = timestamp()
          RETURN source.name AS source, type(r) AS relationship, destination.name AS target
        `;
        params = {
          source_id: sourceNodeSearchResult[0].elementId,
          destination_name: destination,
          destination_embedding: destEmbedding,
          user_id: userId,
        };
      } else if (
        destinationNodeSearchResult.length > 0 &&
        sourceNodeSearchResult.length === 0
      ) {
        // Destination exists, source is new
        cypher = `
          MATCH (destination)
          WHERE id(destination) = $destination_id
          MERGE (source:${sourceType} {name: $source_name, user_id: $user_id})
          ON CREATE SET
              source.created = timestamp(),
              source.embedding = $source_embedding
          MERGE (source)-[r:${relationship}]->(destination)
          ON CREATE SET
              r.created = timestamp()
          RETURN source.name AS source, type(r) AS relationship, destination.name AS target
        `;
        params = {
          destination_id: destinationNodeSearchResult[0].elementId,
          source_name: source,
          source_embedding: sourceEmbedding,
          user_id: userId,
        };
      } else if (
        sourceNodeSearchResult.length > 0 &&
        destinationNodeSearchResult.length > 0
      ) {
        // Both exist
        cypher = `
          MATCH (source)
          WHERE id(source) = $source_id
          MATCH (destination)
          WHERE id(destination) = $destination_id
          MERGE (source)-[r:${relationship}]->(destination)
          ON CREATE SET
              r.created_at = timestamp(),
              r.updated_at = timestamp()
          RETURN source.name AS source, type(r) AS relationship, destination.name AS target
        `;
        params = {
          source_id: sourceNodeSearchResult[0]?.elementId,
          destination_id: destinationNodeSearchResult[0]?.elementId,
          user_id: userId,
        };
      } else {
        // Neither exists
        cypher = `
          MERGE (n:${sourceType} {name: $source_name, user_id: $user_id})
          ON CREATE SET n.created = timestamp(), n.embedding = $source_embedding
          ON MATCH SET n.embedding = $source_embedding
          MERGE (m:${destinationType} {name: $dest_name, user_id: $user_id})
          ON CREATE SET m.created = timestamp(), m.embedding = $dest_embedding
          ON MATCH SET m.embedding = $dest_embedding
          MERGE (n)-[rel:${relationship}]->(m)
          ON CREATE SET rel.created = timestamp()
          RETURN n.name AS source, type(rel) AS relationship, m.name AS target
        `;
        params = {
          source_name: source,
          dest_name: destination,
          source_embedding: sourceEmbedding,
          dest_embedding: destEmbedding,
          user_id: userId,
        };
      }

      const result = await this.graph.query(cypher, params);
      results.push(result);
    }

    return results;
  }

  private _removeSpacesFromEntities(
    entityList: EntityTriple[]
  ): EntityTriple[] {
    return entityList.map((item) => ({
      ...item,
      source: item.source.toLowerCase().replace(/ /g, "_"),
      relationship: item.relationship.toLowerCase().replace(/ /g, "_"),
      destination: item.destination.toLowerCase().replace(/ /g, "_"),
    }));
  }

  private async _searchSourceNode(
    sourceEmbedding: number[],
    userId: string,
    threshold = 0.9
  ): Promise<{ elementId: string }[]> {
    const cypher = `
      MATCH (source_candidate)
      WHERE source_candidate.embedding IS NOT NULL
      AND source_candidate.user_id = $user_id

      WITH source_candidate,
          round(
              reduce(dot = 0.0, i IN range(0, size(source_candidate.embedding)-1) |
                  dot + source_candidate.embedding[i] * $source_embedding[i]) /
              (sqrt(reduce(l2 = 0.0, i IN range(0, size(source_candidate.embedding)-1) |
                  l2 + source_candidate.embedding[i] * source_candidate.embedding[i])) *
              sqrt(reduce(l2 = 0.0, i IN range(0, size($source_embedding)-1) |
                  l2 + $source_embedding[i] * $source_embedding[i])))
              , 4) AS source_similarity
      WHERE source_similarity >= $threshold

      WITH source_candidate, source_similarity
      ORDER BY source_similarity DESC
      LIMIT 1

      RETURN elementId(source_candidate) as element_id
    `;

    const result = await this.graph.query(cypher, {
      source_embedding: sourceEmbedding,
      user_id: userId,
      threshold,
    });

    return result.map((record: any) => ({
      elementId: String(record.element_id),
    }));
  }

  private async _searchDestinationNode(
    destinationEmbedding: number[],
    userId: string,
    threshold = 0.9
  ): Promise<{ elementId: string }[]> {
    const cypher = `
      MATCH (destination_candidate)
      WHERE destination_candidate.embedding IS NOT NULL
      AND destination_candidate.user_id = $user_id

      WITH destination_candidate,
          round(
              reduce(dot = 0.0, i IN range(0, size(destination_candidate.embedding)-1) |
                  dot + destination_candidate.embedding[i] * $destination_embedding[i]) /
              (sqrt(reduce(l2 = 0.0, i IN range(0, size(destination_candidate.embedding)-1) |
                  l2 + destination_candidate.embedding[i] * destination_candidate.embedding[i])) *
              sqrt(reduce(l2 = 0.0, i IN range(0, size($destination_embedding)-1) |
                  l2 + $destination_embedding[i] * $destination_embedding[i])))
          , 4) AS destination_similarity
      WHERE destination_similarity >= $threshold

      WITH destination_candidate, destination_similarity
      ORDER BY destination_similarity DESC
      LIMIT 1

      RETURN elementId(destination_candidate) as element_id
    `;

    const result = await this.graph.query(cypher, {
      destination_embedding: destinationEmbedding,
      user_id: userId,
      threshold,
    });

    return result.map((record: any) => ({
      elementId: String(record.element_id),
    }));
  }
}
