import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { generateGroundedAnswer } from "@/lib/rag/answer";
import { retrieveRelevantChunks } from "@/lib/rag/retrieval";

export const runtime = "nodejs";
export const maxDuration = 60;

const chatRequestSchema = z.object({
  documentId: z.string().trim().min(1, "documentId is required."),
  question: z.string().trim().min(1, "question is required."),
  storage: z.enum(["qdrant", "memory"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = chatRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      throw new AppError("The chat request was invalid.", 400);
    }

    const { documentId, storage, question } = parsedBody.data;
    const chunks = await retrieveRelevantChunks({
      documentId,
      question,
      storage,
    });
    const answer = await generateGroundedAnswer({
      question,
      sources: chunks,
    });

    return NextResponse.json({
      answer,
      sources: chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: chunk.score,
        page: chunk.pageNumber ?? null,
      })),
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: statusCode },
    );
  }
}
