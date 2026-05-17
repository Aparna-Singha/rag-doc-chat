import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { indexExtractedDocument } from "@/lib/rag/index-document";
import { extractTextFromUrl } from "@/lib/rag/ingest-url";

export const runtime = "nodejs";
export const maxDuration = 60;

const ingestUrlRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  url: z.string().trim().url("Enter a valid URL."),
  storage: z.enum(["qdrant", "memory"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = ingestUrlRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      throw new AppError("The URL ingestion request was invalid.", 400);
    }

    const { storage, url, workspaceId } = parsedBody.data;
    const extractedSource = await extractTextFromUrl(url);
    const indexedSource = await indexExtractedDocument({
      workspaceId,
      sourceName: extractedSource.sourceName,
      sourceType: "web",
      sourceUrl: extractedSource.sourceUrl,
      text: extractedSource.text,
      pages: extractedSource.pages,
      storage,
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
