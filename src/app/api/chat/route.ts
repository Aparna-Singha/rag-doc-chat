import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { EMPTY_ANSWER, generateGroundedAnswer } from "@/lib/rag/answer";
import { runCorrectiveRag } from "@/lib/rag/correctiveRag";
import type { ChatSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const chatRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1).optional(),
  question: z.string().trim().min(1, "question is required."),
  storage: z.enum(["qdrant", "memory"]).optional(),
}).superRefine((value, context) => {
  if (!value.workspaceId && !value.documentId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "workspaceId or documentId is required.",
      path: ["workspaceId"],
    });
  }
});

function mapChunkToChatSource(chunk: {
  sourceId: string;
  sourceName: string;
  sourceType: ChatSource["sourceType"];
  snippet: string;
  chunkIndex: number;
  score: number;
  pageNumber?: number | null;
  sourceUrl?: string | null;
}): ChatSource {
  return {
    sourceId: chunk.sourceId,
    sourceName: chunk.sourceName,
    sourceType: chunk.sourceType,
    chunkIndex: chunk.chunkIndex,
    text: chunk.snippet,
    score: chunk.score,
    page: chunk.pageNumber ?? null,
    ...(chunk.sourceUrl ? { url: chunk.sourceUrl } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = chatRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      throw new AppError("The chat request was invalid.", 400);
    }

    const { documentId, storage, question, workspaceId } = parsedBody.data;
    const correctiveRagResult = await runCorrectiveRag({
      workspaceId,
      documentId,
      storage,
      question,
    });
    const answer = correctiveRagResult.corrective.finalRetrievalPassed
      ? await generateGroundedAnswer({
          question,
          sources: correctiveRagResult.chunks,
        })
      : EMPTY_ANSWER;

    return NextResponse.json({
      answer,
      sources: correctiveRagResult.chunks.map(mapChunkToChatSource),
      corrective: correctiveRagResult.corrective,
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: statusCode },
    );
  }
}
