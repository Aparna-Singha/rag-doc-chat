import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { extractTextFromFile } from "@/lib/rag/extractText";
import { chunkText } from "@/lib/rag/chunkText";
import { embedTexts } from "@/lib/rag/embeddings";
import { upsertChunks } from "@/lib/rag/vectorStore";
import { getServerConfig } from "@/lib/server-config";
import { validateUploadSize } from "@/lib/uploads/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new AppError(
        "Invalid upload request. Use multipart/form-data with a file field.",
        400,
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new AppError("Please choose a file to upload.", 400);
    }

    const { maxFileSizeMb } = getServerConfig();
    validateUploadSize({
      fileSize: file.size,
      maxFileSizeMb,
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const documentId = randomUUID();

    let extractedDocument;

    try {
      extractedDocument = await extractTextFromFile({
        buffer,
        fileName: file.name,
        mimeType: file.type,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("We couldn't extract readable text from that file.", 400);
    }

    const chunks = chunkText({
      documentId,
      fileName: extractedDocument.fileName,
      fileType: extractedDocument.fileType,
      text: extractedDocument.text,
      pages: extractedDocument.pages,
    });

    if (chunks.length === 0) {
      throw new AppError(
        "The uploaded document did not produce any searchable chunks.",
        400,
      );
    }

    let embeddings;

    try {
      embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "We couldn't generate embeddings for the uploaded document.",
        502,
      );
    }

    let storage;

    try {
      storage = await upsertChunks(documentId, chunks, embeddings);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "We couldn't store the document in the vector database.",
        502,
      );
    }

    return NextResponse.json({
      success: true,
      documentId,
      fileName: extractedDocument.fileName,
      fileType: extractedDocument.fileType,
      chunkCount: chunks.length,
      pageCount: extractedDocument.pageCount,
      storage,
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: statusCode },
    );
  }
}
