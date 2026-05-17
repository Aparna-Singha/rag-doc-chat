import { embedQuery } from "@/lib/rag/embeddings";
import { gradeRetrievedChunks } from "@/lib/rag/gradeRetrieval";
import { filterRelevantChunks } from "@/lib/rag/retrieval";
import { rewriteQueryForRetrieval } from "@/lib/rag/rewriteQuery";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { getServerConfig } from "@/lib/server-config";
import type {
  CorrectiveRagMetadata,
  CorrectiveRagResult,
  RetrievedChunk,
  VectorStoreProvider,
} from "@/lib/types";

async function retrieveChunks(params: {
  workspaceId?: string;
  documentId?: string;
  query: string;
  topK: number;
  storage?: VectorStoreProvider;
}): Promise<RetrievedChunk[]> {
  const questionEmbedding = await embedQuery(params.query);
  const chunks = await searchSimilarChunks({
    workspaceId: params.workspaceId,
    documentId: params.documentId,
    queryEmbedding: questionEmbedding,
    topK: params.topK,
    preferredProvider: params.storage,
  });

  return filterRelevantChunks(chunks);
}

function buildResult(
  chunks: RetrievedChunk[],
  corrective: CorrectiveRagMetadata,
): CorrectiveRagResult {
  return {
    chunks,
    corrective,
  };
}

export async function runCorrectiveRag(params: {
  workspaceId?: string;
  documentId?: string;
  question: string;
  topK?: number;
  storage?: VectorStoreProvider;
}): Promise<CorrectiveRagResult> {
  const question = params.question.trim();
  const { ragTopK } = getServerConfig();
  const topK = params.topK ?? ragTopK;
  const initialChunks = await retrieveChunks({
    workspaceId: params.workspaceId,
    documentId: params.documentId,
    query: question,
    topK,
    storage: params.storage,
  });
  const initialGrade = await gradeRetrievedChunks(question, initialChunks);

  if (initialGrade.relevant) {
    return buildResult(initialChunks, {
      enabled: true,
      initialQuery: question,
      initialRetrievalPassed: true,
      secondRetrievalUsed: false,
      finalRetrievalPassed: true,
      reason: initialGrade.reason,
      retrievalMode: "direct",
    });
  }

  const rewrittenQuery = await rewriteQueryForRetrieval(question);
  const normalizedRewrittenQuery = rewrittenQuery.trim();
  const usedRewrittenQuery =
    normalizedRewrittenQuery.length > 0 &&
    normalizedRewrittenQuery.toLowerCase() !== question.toLowerCase();
  const secondPassQuery = usedRewrittenQuery
    ? normalizedRewrittenQuery
    : question;

  const secondChunks = await retrieveChunks({
    workspaceId: params.workspaceId,
    documentId: params.documentId,
    query: secondPassQuery,
    topK,
    storage: params.storage,
  });
  const secondGrade = await gradeRetrievedChunks(question, secondChunks);

  if (secondGrade.relevant) {
    return buildResult(secondChunks, {
      enabled: true,
      initialQuery: question,
      ...(usedRewrittenQuery
        ? { rewrittenQuery: normalizedRewrittenQuery }
        : {}),
      initialRetrievalPassed: false,
      secondRetrievalUsed: true,
      finalRetrievalPassed: true,
      reason: secondGrade.reason,
      retrievalMode: "corrected",
    });
  }

  return buildResult([], {
    enabled: true,
    initialQuery: question,
    ...(usedRewrittenQuery ? { rewrittenQuery: normalizedRewrittenQuery } : {}),
    initialRetrievalPassed: false,
    secondRetrievalUsed: true,
    finalRetrievalPassed: false,
    reason: secondGrade.reason,
    retrievalMode: "insufficient_context",
  });
}
