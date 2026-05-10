import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import { chunkText } from "@/lib/rag/chunkText";
import { embedTexts } from "@/lib/rag/embeddings";
import { upsertChunks } from "@/lib/rag/vectorStore";
import type { ExtractedPage, SupportedFileType, UploadResult } from "@/lib/types";

export async function indexExtractedDocument(params: {
  fileName: string;
  fileType: SupportedFileType;
  text: string;
  pages: ExtractedPage[];
}): Promise<UploadResult> {
  const documentId = randomUUID();
  const chunks = chunkText({
    documentId,
    fileName: params.fileName,
    fileType: params.fileType,
    text: params.text,
    pages: params.pages,
  });

  if (chunks.length === 0) {
    throw new AppError(
      "The uploaded document did not produce any searchable chunks.",
      400,
    );
  }

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  const storage = await upsertChunks(documentId, chunks, embeddings);

  return {
    success: true,
    documentId,
    fileName: params.fileName,
    fileType: params.fileType,
    chunkCount: chunks.length,
    pageCount: params.pages.length > 0 ? params.pages.length : 1,
    storage,
  };
}
