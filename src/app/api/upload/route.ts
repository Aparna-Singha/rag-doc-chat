import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { extractTextFromFile } from "@/lib/rag/extractText";
import { indexExtractedDocument } from "@/lib/rag/index-document";
import { getServerConfig } from "@/lib/server-config";
import type { VectorStoreProvider } from "@/lib/types";
import { validateUploadSize } from "@/lib/uploads/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeOptionalFormValue(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function parseOptionalStorage(
  value: FormDataEntryValue | null,
): VectorStoreProvider | undefined {
  const normalizedValue = normalizeOptionalFormValue(value);

  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue === "qdrant" || normalizedValue === "memory") {
    return normalizedValue;
  }

  throw new AppError("Invalid storage provider.", 400);
}

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
    const workspaceId = normalizeOptionalFormValue(formData.get("workspaceId"));
    const preferredStorage = parseOptionalStorage(formData.get("storage"));

    if (!(file instanceof File)) {
      throw new AppError("Please choose a file to upload.", 400);
    }

    const { maxFileSizeMb } = getServerConfig();
    validateUploadSize({
      fileSize: file.size,
      maxFileSizeMb,
    });

    const buffer = Buffer.from(await file.arrayBuffer());
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

    const indexedSource = await indexExtractedDocument({
      workspaceId,
      sourceName: extractedDocument.fileName,
      sourceType: extractedDocument.fileType,
      fileName: extractedDocument.fileName,
      fileType: extractedDocument.fileType,
      text: extractedDocument.text,
      pages: extractedDocument.pages,
      storage: preferredStorage,
    });

    return NextResponse.json(indexedSource);
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
