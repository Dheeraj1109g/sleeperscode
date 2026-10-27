import { describe, expect, it } from "vite-plus/test";

import {
  cosineSimilarity,
  dotProduct,
  euclideanDistance,
  normalizeVector,
  VectorSearchIndex,
} from "./vectorSearchEngine.ts";

describe("Vector Math Functions", () => {
  it("calculates exact cosine similarity for identical and orthogonal vectors", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBe(1);
    expect(cosineSimilarity(v1, v3)).toBe(0);
  });

  it("calculates dot product correctly", () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("calculates Euclidean distance accurately", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it("normalizes vectors to unit length", () => {
    const norm = normalizeVector([3, 4]);
    expect(norm).toEqual([0.6, 0.8]);
  });
});

describe("VectorSearchIndex", () => {
  it("indexes and retrieves nearest documents by cosine similarity", () => {
    const index = new VectorSearchIndex<string>(3);
    index.add({ id: "doc1", text: "React Frontend Code", vector: [1, 0, 0], metadata: "web" });
    index.add({ id: "doc2", text: "Node Backend Service", vector: [0, 1, 0], metadata: "server" });
    index.add({
      id: "doc3",
      text: "React Native Mobile",
      vector: [0.9, 0.1, 0],
      metadata: "mobile",
    });

    const results = index.search([1, 0, 0], { topK: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe("doc1");
    expect(results[0]?.score).toBe(1);
    expect(results[1]?.id).toBe("doc3");
  });

  it("performs hybrid keyword + vector retrieval", () => {
    const index = new VectorSearchIndex<string>(3);
    index.add({ id: "d1", text: "Optimization and caching mechanisms", vector: [0.8, 0.2, 0] });
    index.add({ id: "d2", text: "Database migrations and schema", vector: [0.1, 0.9, 0] });

    const results = index.hybridSearch("caching mechanisms", [0.8, 0.2, 0]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe("d1");
  });

  it("enforces dimension matching", () => {
    const index = new VectorSearchIndex(2);
    expect(() => index.add({ id: "err", text: "test", vector: [1, 2, 3] })).toThrow(
      "dimension mismatch",
    );
  });
});
