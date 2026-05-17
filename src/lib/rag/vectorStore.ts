import { QdrantClient } from "@qdrant/js-client-rest";

import { AppError } from "@/lib/errors";
import { getServerConfig } from "@/lib/server-config";
import type {
  DocumentChunk,
  RetrievedChunk,
  SupportedFileType,
  VectorStoreProvider,
} from "@/lib/types";

interface MemoryPoint {
  vector: number[];
  chunk: DocumentChunk;
}

declare global {
  var __askMyDocMemoryWorkspaceStore: Map<string, MemoryPoint[]> | undefined;
  var __askMyDocMemorySourceStore: Map<string, MemoryPoint[]> | undefined;
}

const QDRANT_PROVIDER = "qdrant" as const;
const MEMORY_PROVIDER = "memory" as const;
const LOCAL_QDRANT_URL = "http://127.0.0.1:6333";

function isMemoryFallbackAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

function resolveQdrantUrl(): string {
  const { qdrantUrl } = getServerConfig();

  if (qdrantUrl) {
    return qdrantUrl;
  }

  if (isMemoryFallbackAllowed()) {
    return LOCAL_QDRANT_URL;
  }

  throw getMissingQdrantUrlError();
}

function getMissingQdrantUrlError(): AppError {
  return new AppError(
    "Missing QDRANT_URL. Set it to your local Qdrant Docker URL in .env.local or to your Qdrant Cloud URL in the deployment environment.",
    500,
  );
}

function createRetrievedChunk(
  chunk: DocumentChunk,
  score: number,
  rank: number,
): RetrievedChunk {
  return {
    ...chunk,
    score,
    sourceLabel: `S${rank + 1}`,
  };
}

function getMemoryStores(): {
  byWorkspace: Map<string, MemoryPoint[]>;
  bySource: Map<string, MemoryPoint[]>;
} {
  if (!globalThis.__askMyDocMemoryWorkspaceStore) {
    globalThis.__askMyDocMemoryWorkspaceStore = new Map<string, MemoryPoint[]>();
  }

  if (!globalThis.__askMyDocMemorySourceStore) {
    globalThis.__askMyDocMemorySourceStore = new Map<string, MemoryPoint[]>();
  }

  return {
    byWorkspace: globalThis.__askMyDocMemoryWorkspaceStore,
    bySource: globalThis.__askMyDocMemorySourceStore,
  };
}

function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const length = Math.min(vectorA.length, vectorB.length);

  for (let index = 0; index < length; index += 1) {
    dotProduct += vectorA[index] * vectorB[index];
    normA += vectorA[index] * vectorA[index];
    normB += vectorB[index] * vectorB[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeChunksForWorkspace(
  workspaceId: string,
  chunks: DocumentChunk[],
): DocumentChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    workspaceId,
    sourceId: chunk.sourceId || chunk.documentId,
    documentId: chunk.documentId || chunk.sourceId,
  }));
}

function validateUpsertInputs(
  chunks: DocumentChunk[],
  embeddings: number[][],
): void {
  if (chunks.length === 0) {
    throw new AppError("No chunks were provided for vector storage.", 400);
  }

  if (chunks.length !== embeddings.length) {
    throw new AppError(
      "Chunk and embedding counts do not match during vector storage.",
      500,
    );
  }

  if (embeddings.some((embedding) => embedding.length === 0)) {
    throw new AppError("One or more chunk embeddings are empty.", 500);
  }
}

function payloadToChunk(
  payload: Record<string, unknown> | null | undefined,
): DocumentChunk {
  if (!payload) {
    throw new AppError("A stored vector result was missing its payload.", 500);
  }

  const fileType =
    payload.fileType === null || payload.fileType === undefined
      ? null
      : (String(payload.fileType) as SupportedFileType);
  const sourceId = String(payload.sourceId ?? payload.documentId);

  return {
    id: String(payload.id),
    workspaceId: String(payload.workspaceId ?? payload.documentId ?? sourceId),
    sourceId,
    documentId: String(payload.documentId ?? sourceId),
    sourceName: String(
      payload.sourceName ?? payload.fileName ?? payload.documentName ?? "unknown",
    ),
    sourceType: String(payload.sourceType ?? payload.fileType ?? "txt") as DocumentChunk["sourceType"],
    sourceUrl:
      payload.sourceUrl === null || payload.sourceUrl === undefined
        ? null
        : String(payload.sourceUrl),
    fileName:
      payload.fileName === null || payload.fileName === undefined
        ? null
        : String(payload.fileName),
    fileType,
    chunkIndex: Number(payload.chunkIndex),
    pageNumber:
      payload.pageNumber === null || payload.pageNumber === undefined
        ? null
        : Number(payload.pageNumber),
    snippet: String(payload.snippet ?? payload.text ?? ""),
    text: String(payload.text),
  };
}

function getQdrantClient(): QdrantClient {
  const config = getServerConfig();

  return new QdrantClient({
    url: resolveQdrantUrl(),
    apiKey: config.qdrantApiKey,
  });
}

async function isQdrantAvailable(): Promise<boolean> {
  try {
    await getQdrantClient().getCollections();
    return true;
  } catch {
    return false;
  }
}

async function ensurePayloadIndexes(
  client: QdrantClient,
  collectionName: string,
): Promise<void> {
  const fields = ["workspaceId", "documentId", "sourceId", "sourceType"];

  await Promise.all(
    fields.map(async (fieldName) => {
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: fieldName,
          field_schema: "keyword",
          wait: true,
        });
      } catch {
        // Ignore duplicate or unsupported payload index creation errors.
      }
    }),
  );
}

async function ensureQdrantCollection(vectorSize: number): Promise<void> {
  const client = getQdrantClient();
  const { qdrantCollectionName } = getServerConfig();
  const collections = await client.getCollections();
  const collectionExists = collections.collections.some(
    (collection) => collection.name === qdrantCollectionName,
  );

  if (!collectionExists) {
    await client.createCollection(qdrantCollectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }

  await ensurePayloadIndexes(client, qdrantCollectionName);
}

async function resolveProvider(
  preferredProvider?: VectorStoreProvider,
): Promise<VectorStoreProvider> {
  const allowMemoryFallback = isMemoryFallbackAllowed();
  const { qdrantUrl } = getServerConfig();
  const hasQdrantTarget = Boolean(qdrantUrl || allowMemoryFallback);

  if (preferredProvider === MEMORY_PROVIDER) {
    if (!allowMemoryFallback) {
      throw new AppError(
        "The in-memory vector store is available only in local development. Configure QDRANT_URL for deployed environments.",
        503,
      );
    }

    return MEMORY_PROVIDER;
  }

  if (preferredProvider === QDRANT_PROVIDER) {
    if (!qdrantUrl && !allowMemoryFallback) {
      throw getMissingQdrantUrlError();
    }

    if (!(await isQdrantAvailable())) {
      throw new AppError(
        "Qdrant is currently unavailable. Check QDRANT_URL, QDRANT_API_KEY, and network access to your Qdrant instance.",
        503,
      );
    }

    return QDRANT_PROVIDER;
  }

  if (!hasQdrantTarget) {
    if (allowMemoryFallback) {
      return MEMORY_PROVIDER;
    }

    throw getMissingQdrantUrlError();
  }

  if (await isQdrantAvailable()) {
    return QDRANT_PROVIDER;
  }

  if (allowMemoryFallback) {
    return MEMORY_PROVIDER;
  }

  throw new AppError(
    "Qdrant is currently unavailable. Configure a reachable Qdrant instance for production or Vercel deployments. The in-memory fallback is only available in local development.",
    503,
  );
}

async function upsertChunksToMemoryStore(
  workspaceId: string,
  chunks: DocumentChunk[],
  embeddings: number[][],
): Promise<void> {
  const stores = getMemoryStores();
  const normalizedChunks = normalizeChunksForWorkspace(workspaceId, chunks);
  const newPoints = normalizedChunks.map((chunk, index) => ({
    chunk,
    vector: embeddings[index],
  }));
  const sourceIds = new Set(newPoints.map((point) => point.chunk.sourceId));
  const existingWorkspacePoints = stores.byWorkspace.get(workspaceId) ?? [];

  stores.byWorkspace.set(
    workspaceId,
    [
      ...existingWorkspacePoints.filter(
        (point) => !sourceIds.has(point.chunk.sourceId),
      ),
      ...newPoints,
    ],
  );

  for (const sourceId of sourceIds) {
    stores.bySource.set(
      sourceId,
      newPoints.filter((point) => point.chunk.sourceId === sourceId),
    );
  }
}

async function upsertChunksToQdrant(
  workspaceId: string,
  chunks: DocumentChunk[],
  embeddings: number[][],
): Promise<void> {
  const client = getQdrantClient();
  const { qdrantCollectionName } = getServerConfig();
  const normalizedChunks = normalizeChunksForWorkspace(workspaceId, chunks);
  const firstVector = embeddings[0];

  if (!firstVector) {
    throw new AppError("No embeddings were provided for vector storage.", 500);
  }

  await ensureQdrantCollection(firstVector.length);

  await client.upsert(qdrantCollectionName, {
    wait: true,
    points: normalizedChunks.map((chunk, index) => ({
      id: chunk.id,
      vector: embeddings[index],
      payload: {
        workspaceId,
        sourceId: chunk.sourceId,
        documentId: chunk.documentId,
        sourceName: chunk.sourceName,
        sourceType: chunk.sourceType,
        sourceUrl: chunk.sourceUrl ?? null,
        text: chunk.text,
        fileName: chunk.fileName ?? null,
        fileType: chunk.fileType ?? null,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber ?? null,
        snippet: chunk.snippet,
        id: chunk.id,
      },
    })),
  });
}

async function searchMemoryStore(params: {
  workspaceId?: string;
  documentId?: string;
  queryEmbedding: number[];
  topK: number;
}): Promise<RetrievedChunk[]> {
  const stores = getMemoryStores();
  const points = params.workspaceId
    ? stores.byWorkspace.get(params.workspaceId) ?? []
    : stores.bySource.get(params.documentId ?? "") ?? [];

  return points
    .map((point) => ({
      chunk: point.chunk,
      score: cosineSimilarity(params.queryEmbedding, point.vector),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, params.topK)
    .map(({ chunk, score }, rank) => createRetrievedChunk(chunk, score, rank));
}

async function searchQdrantStore(params: {
  workspaceId?: string;
  documentId?: string;
  queryEmbedding: number[];
  topK: number;
}): Promise<RetrievedChunk[]> {
  const client = getQdrantClient();
  const { qdrantCollectionName } = getServerConfig();
  const filterKey = params.workspaceId ? "workspaceId" : "documentId";
  const filterValue = params.workspaceId ?? params.documentId;

  if (!filterValue) {
    throw new AppError(
      "A workspaceId or documentId is required for retrieval.",
      400,
    );
  }

  const results = await client.search(qdrantCollectionName, {
    vector: params.queryEmbedding,
    limit: params.topK,
    with_payload: true,
    filter: {
      must: [
        {
          key: filterKey,
          match: {
            value: filterValue,
          },
        },
      ],
    },
  });

  return results.map((result, rank) => {
    const chunk = payloadToChunk(result.payload as Record<string, unknown>);
    return createRetrievedChunk(chunk, result.score, rank);
  });
}

export async function upsertChunks(
  workspaceId: string,
  chunks: DocumentChunk[],
  embeddings: number[][],
  preferredProvider?: VectorStoreProvider,
): Promise<VectorStoreProvider> {
  validateUpsertInputs(chunks, embeddings);

  const provider = await resolveProvider(preferredProvider);

  try {
    if (provider === QDRANT_PROVIDER) {
      await upsertChunksToQdrant(workspaceId, chunks, embeddings);
      return QDRANT_PROVIDER;
    }

    await upsertChunksToMemoryStore(workspaceId, chunks, embeddings);
    return MEMORY_PROVIDER;
  } catch (error) {
    if (
      provider === QDRANT_PROVIDER &&
      !preferredProvider &&
      isMemoryFallbackAllowed()
    ) {
      await upsertChunksToMemoryStore(workspaceId, chunks, embeddings);
      return MEMORY_PROVIDER;
    }

    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AppError(`Vector storage failed: ${error.message}`, 502);
    }

    throw new AppError("Vector storage failed unexpectedly.", 502);
  }
}

export async function searchSimilarChunks(params: {
  workspaceId?: string;
  documentId?: string;
  queryEmbedding: number[];
  topK: number;
  preferredProvider?: VectorStoreProvider;
}): Promise<RetrievedChunk[]> {
  if (!params.workspaceId?.trim() && !params.documentId?.trim()) {
    throw new AppError(
      "A workspaceId or documentId is required for retrieval.",
      400,
    );
  }

  if (params.queryEmbedding.length === 0) {
    throw new AppError("A query embedding is required for retrieval.", 400);
  }

  if (params.topK <= 0) {
    throw new AppError("topK must be greater than zero for retrieval.", 400);
  }

  const provider = await resolveProvider(params.preferredProvider);

  try {
    if (provider === QDRANT_PROVIDER) {
      return await searchQdrantStore(params);
    }

    return await searchMemoryStore(params);
  } catch (error) {
    if (
      provider === QDRANT_PROVIDER &&
      !params.preferredProvider &&
      isMemoryFallbackAllowed()
    ) {
      return searchMemoryStore(params);
    }

    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AppError(`Vector retrieval failed: ${error.message}`, 502);
    }

    throw new AppError("Vector retrieval failed unexpectedly.", 502);
  }
}
