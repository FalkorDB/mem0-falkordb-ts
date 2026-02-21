import { FalkorDBGraph } from "../src/FalkorDBGraph";

// Mock falkordb module
const mockQuery = jest.fn();
const mockClose = jest.fn();
const mockSelectGraph = jest.fn().mockReturnValue({ query: mockQuery });
const mockConnect = jest.fn().mockResolvedValue({
  selectGraph: mockSelectGraph,
  close: mockClose,
});

jest.mock("falkordb", () => ({
  FalkorDB: {
    connect: (...args: any[]) => mockConnect(...args),
  },
}));

describe("FalkorDBGraph", () => {
  let graph: FalkorDBGraph;

  beforeEach(() => {
    jest.clearAllMocks();
    graph = new FalkorDBGraph({
      host: "localhost",
      port: 6379,
      graphName: "test_graph",
    });
  });

  afterEach(async () => {
    // Reset internal state
    await graph.close().catch(() => {});
  });

  describe("constructor and init", () => {
    it("connects with correct URL on first query", async () => {
      mockQuery.mockResolvedValueOnce({ data: [] });

      await graph.query("RETURN 1");

      expect(mockConnect).toHaveBeenCalledWith({
        url: "redis://localhost:6379",
      });
      expect(mockSelectGraph).toHaveBeenCalledWith("test_graph");
    });

    it("uses default graph name 'mem0' when not specified", async () => {
      const defaultGraph = new FalkorDBGraph({
        host: "myhost",
        port: 6380,
      });
      mockQuery.mockResolvedValueOnce({ data: [] });

      await defaultGraph.query("RETURN 1");

      expect(mockConnect).toHaveBeenCalledWith({
        url: "redis://myhost:6380",
      });
      expect(mockSelectGraph).toHaveBeenCalledWith("mem0");
    });

    it("includes password in URL when provided", async () => {
      const authGraph = new FalkorDBGraph({
        host: "localhost",
        port: 6379,
        password: "secret",
      });
      mockQuery.mockResolvedValueOnce({ data: [] });

      await authGraph.query("RETURN 1");

      expect(mockConnect).toHaveBeenCalledWith({
        url: "redis://:secret@localhost:6379",
      });
    });

    it("includes username and password in URL when both provided", async () => {
      const authGraph = new FalkorDBGraph({
        host: "localhost",
        port: 6379,
        username: "admin",
        password: "secret",
      });
      mockQuery.mockResolvedValueOnce({ data: [] });

      await authGraph.query("RETURN 1");

      expect(mockConnect).toHaveBeenCalledWith({
        url: "redis://admin:secret@localhost:6379",
      });
    });

    it("only initializes once", async () => {
      mockQuery.mockResolvedValue({ data: [] });

      await graph.query("RETURN 1");
      await graph.query("RETURN 2");

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("query", () => {
    it("returns data from query result", async () => {
      const mockData = [{ name: "Alice" }, { name: "Bob" }];
      mockQuery.mockResolvedValueOnce({ data: mockData, metadata: [] });

      const result = await graph.query("MATCH (n) RETURN n.name AS name");

      expect(result).toEqual(mockData);
    });

    it("returns empty array when data is undefined", async () => {
      mockQuery.mockResolvedValueOnce({ metadata: ["Nodes created: 1"] });

      const result = await graph.query("CREATE (:Person {name: 'Test'})");

      expect(result).toEqual([]);
    });

    it("passes translated query and params to graph.query", async () => {
      mockQuery.mockResolvedValueOnce({ data: [] });

      // elementId should be translated to id
      await graph.query("RETURN elementId(n) AS nid", { foo: "bar" });

      expect(mockQuery).toHaveBeenCalledWith("RETURN id(n) AS nid", {
        params: { foo: "bar" },
      });
    });

    it("wraps errors with query context", async () => {
      mockQuery.mockRejectedValueOnce(new Error("syntax error"));

      await expect(graph.query("INVALID QUERY")).rejects.toThrow(
        "FalkorDB query failed: syntax error"
      );
    });

    it("includes query string in error message", async () => {
      mockQuery.mockRejectedValueOnce(new Error("parse error"));

      await expect(graph.query("BAD CYPHER")).rejects.toThrow("BAD CYPHER");
    });
  });

  describe("close", () => {
    it("calls client.close()", async () => {
      mockQuery.mockResolvedValueOnce({ data: [] });
      await graph.query("RETURN 1"); // trigger init

      await graph.close();

      expect(mockClose).toHaveBeenCalled();
    });

    it("does not throw if not initialized", async () => {
      await expect(graph.close()).resolves.toBeUndefined();
    });
  });
});
