/**
 * In-Memory Vector Search and Hybrid Similarity Engine.
 *
 * Provides dense embedding indexing, cosine similarity, Euclidean distance,
 * normalization, and hybrid BM25 + vector ranking for agent code/doc search.
 *
 * @module vectorSearchEngine
 */

export interface VectorDocument<T = unknown> {
  readonly id: string;
  readonly text: string;
  readonly vector: readonly number[];
  readonly metadata?: T;
}

export interface SearchResult<T = unknown> {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly metadata?: T;
}

export type SimilarityMetric = "cosine" | "dotProduct" | "euclidean";

export interface VectorSearchOptions {
  readonly topK?: number;
  readonly metric?: SimilarityMetric;
  readonly minScoreThreshold?: number;
}

/**
 * Computes cosine similarity between two numeric vectors. Range: [-1, 1].
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return Math.max(-1, Math.min(1, dotProduct / denominator));
}

/**
 * Computes dot product between two numeric vectors.
 */
export function dotProduct(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Computes Euclidean distance between two vectors.
 */
export function euclideanDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 */
export function normalizeVector(vector: readonly number[]): readonly number[] {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i]! * vector[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vector.slice();
  return vector.map((v) => Number((v / norm).toFixed(6)));
}

/**
 * Lightweight in-memory vector index supporting dynamic addition and nearest-neighbor search.
 */
export class VectorSearchIndex<T = unknown> {
  private readonly documents: Map<string, VectorDocument<T>> = new Map();
  private expectedDimension?: number;

  constructor(dimension?: number) {
    this.expectedDimension = dimension;
  }

  public add(doc: VectorDocument<T>): void {
    if (this.expectedDimension && doc.vector.length !== this.expectedDimension) {
      throw new Error(
        `Vector dimension mismatch. Expected ${this.expectedDimension}, got ${doc.vector.length}`,
      );
    }
    if (!this.expectedDimension) {
      this.expectedDimension = doc.vector.length;
    }
    this.documents.set(doc.id, doc);
  }

  public addMany(docs: readonly VectorDocument<T>[]): void {
    for (const doc of docs) {
      this.add(doc);
    }
  }

  public remove(id: string): boolean {
    return this.documents.delete(id);
  }

  public clear(): void {
    this.documents.clear();
  }

  public size(): number {
    return this.documents.size;
  }

  public search(
    queryVector: readonly number[],
    options: VectorSearchOptions = {},
  ): readonly SearchResult<T>[] {
    const { topK = 5, metric = "cosine", minScoreThreshold = -1 } = options;
    const results: SearchResult<T>[] = [];

    for (const doc of this.documents.values()) {
      let score = 0;
      if (metric === "cosine") {
        score = cosineSimilarity(queryVector, doc.vector);
      } else if (metric === "dotProduct") {
        score = dotProduct(queryVector, doc.vector);
      } else if (metric === "euclidean") {
        // Convert distance to positive similarity score
        const dist = euclideanDistance(queryVector, doc.vector);
        score = 1 / (1 + dist);
      }

      if (score >= minScoreThreshold) {
        results.push({
          id: doc.id,
          text: doc.text,
          score: Number(score.toFixed(6)),
          metadata: doc.metadata,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Hybrid search combining keyword matching with vector similarity.
   */
  public hybridSearch(
    queryText: string,
    queryVector: readonly number[],
    options: VectorSearchOptions & { keywordWeight?: number; vectorWeight?: number } = {},
  ): readonly SearchResult<T>[] {
    const { topK = 5, keywordWeight = 0.3, vectorWeight = 0.7 } = options;
    const keywords = queryText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const results: SearchResult<T>[] = [];

    for (const doc of this.documents.values()) {
      const vScore = cosineSimilarity(queryVector, doc.vector);

      // Keyword term-frequency scoring
      let keywordHits = 0;
      const lowerText = doc.text.toLowerCase();
      for (const kw of keywords) {
        if (lowerText.includes(kw)) keywordHits++;
      }
      const kScore = keywords.length > 0 ? keywordHits / keywords.length : 0;

      const hybridScore = kScore * keywordWeight + Math.max(0, vScore) * vectorWeight;

      results.push({
        id: doc.id,
        text: doc.text,
        score: Number(hybridScore.toFixed(6)),
        metadata: doc.metadata,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
