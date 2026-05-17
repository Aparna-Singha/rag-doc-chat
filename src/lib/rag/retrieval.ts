import { embedQuery } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { getServerConfig } from "@/lib/server-config";
import type { RetrievedChunk, VectorStoreProvider } from "@/lib/types";

const MIN_TOP_RELEVANCE_SCORE = 0.2;
const MIN_RETAINED_SOURCE_SCORE = 0.15;
const RELATIVE_SCORE_RATIO = 0.75;

export function filterRelevantChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  if (chunks.length === 0) {
    return [];
  }

  const topScore = chunks[0]?.score ?? 0;

  if (!Number.isFinite(topScore) || topScore < MIN_TOP_RELEVANCE_SCORE) {
    return [];
  }

  const minimumAcceptedScore = Math.max(
    MIN_RETAINED_SOURCE_SCORE,
    topScore * RELATIVE_SCORE_RATIO,
  );

  return chunks.filter((chunk) => chunk.score >= minimumAcceptedScore);
}

export async function retrieveRelevantChunks(params: {
  workspaceId?: string;
  documentId?: string;
  question: string;
  storage?: VectorStoreProvider;
}): Promise<RetrievedChunk[]> {
  const { ragTopK } = getServerConfig();
  const questionEmbedding = await embedQuery(params.question);
  const chunks = await searchSimilarChunks({
    workspaceId: params.workspaceId,
    documentId: params.documentId,
    queryEmbedding: questionEmbedding,
    topK: ragTopK,
    preferredProvider: params.storage,
  });

  return filterRelevantChunks(chunks);
}
