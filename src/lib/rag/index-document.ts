import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import { chunkText } from "@/lib/rag/chunkText";
import { embedTexts } from "@/lib/rag/embeddings";
import { upsertChunks } from "@/lib/rag/vectorStore";
import type {
  ExtractedPage,
  IndexedSourceResult,
  SourceType,
  SupportedFileType,
  VectorStoreProvider,
} from "@/lib/types";

export async function indexExtractedDocument(params: {
  workspaceId?: string;
  sourceId?: string;
  sourceName: string;
  sourceType: SourceType;
  sourceUrl?: string;
  fileName?: string;
  fileType?: SupportedFileType;
  text: string;
  pages: ExtractedPage[];
  storage?: VectorStoreProvider;
}): Promise<IndexedSourceResult> {
  const sourceId = params.sourceId ?? randomUUID();
  const workspaceId = params.workspaceId?.trim() || sourceId;
  const chunks = chunkText({
    workspaceId,
    sourceId,
    sourceName: params.sourceName,
    sourceType: params.sourceType,
    sourceUrl: params.sourceUrl ?? null,
    fileName: params.fileName ?? params.sourceName,
    fileType: params.fileType ?? null,
    text: params.text,
    pages: params.pages,
  });

  if (chunks.length === 0) {
    throw new AppError(
      "The uploaded source did not produce any searchable chunks.",
      400,
    );
  }

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  const storage = await upsertChunks(workspaceId, chunks, embeddings, params.storage);

  return {
    success: true,
    workspaceId,
    sourceId,
    documentId: sourceId,
    sourceName: params.sourceName,
    sourceType: params.sourceType,
    chunkCount: chunks.length,
    pageCount: params.pages.length > 0 ? params.pages.length : 1,
    url: params.sourceUrl,
    fileName: params.fileName,
    fileType: params.fileType,
    storage,
  };
}
