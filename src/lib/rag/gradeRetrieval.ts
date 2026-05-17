import { getGeminiClient } from "@/lib/rag/gemini";
import { getServerConfig } from "@/lib/server-config";
import type { RetrievalGrade, RetrievedChunk } from "@/lib/types";

interface LlmRetrievalGrade {
  relevant: boolean;
  reason: string;
}

const GRADING_SYSTEM_PROMPT = `
You grade whether retrieved document excerpts are sufficient to answer a user question.

Rules:
- Return strict JSON only.
- Use only the provided question and retrieved document context.
- Mark relevant true only when the retrieved context likely contains enough information to answer the question directly.
- Mark relevant false when the context is missing the answer, is too vague, or appears off-topic.
- Keep the reason short, factual, and user-safe.
- Do not reveal chain-of-thought.
`.trim();

function normalizeReason(reason: string | null | undefined): string {
  const normalizedReason = reason?.trim();

  if (!normalizedReason) {
    return "Retrieved context did not pass the relevance check.";
  }

  return normalizedReason.slice(0, 200);
}

function buildRetrievedContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `Chunk ${chunk.chunkIndex + 1} (score ${chunk.score.toFixed(3)})${chunk.pageNumber ? ` from page ${chunk.pageNumber}` : ""}\n${chunk.text}`,
    )
    .join("\n\n");
}

function stripCodeFences(value: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue.startsWith("```")) {
    return normalizedValue;
  }

  return normalizedValue
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseLlmGrade(value: string | null | undefined): LlmRetrievalGrade | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(stripCodeFences(normalizedValue)) as
      | Partial<LlmRetrievalGrade>
      | null;

    if (
      !parsedValue ||
      typeof parsedValue.relevant !== "boolean" ||
      typeof parsedValue.reason !== "string"
    ) {
      return null;
    }

    return {
      relevant: parsedValue.relevant,
      reason: normalizeReason(parsedValue.reason),
    };
  } catch {
    return null;
  }
}

async function gradeWithLlm(
  question: string,
  chunks: RetrievedChunk[],
): Promise<LlmRetrievalGrade | null> {
  const { geminiModel } = getServerConfig();
  const client = getGeminiClient();
  const prompt = `
Question:
${question}

Retrieved context:
${buildRetrievedContext(chunks)}

Decide whether the retrieved context contains enough information to answer the question.
Return JSON with this exact shape:
{
  "relevant": true,
  "reason": "short reason"
}
`.trim();

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
    config: {
      systemInstruction: GRADING_SYSTEM_PROMPT,
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  return tryParseLlmGrade(response.text);
}

export async function gradeRetrievedChunks(
  question: string,
  chunks: RetrievedChunk[],
): Promise<RetrievalGrade> {
  const normalizedQuestion = question.trim();
  const { ragMinRelevanceScore } = getServerConfig();

  if (!normalizedQuestion) {
    return {
      relevant: false,
      reason: "The question was empty.",
      topScore: null,
      usedLlm: false,
      usedScoreFallback: false,
    };
  }

  if (chunks.length === 0) {
    return {
      relevant: false,
      reason: "No matching document chunks were retrieved.",
      topScore: null,
      usedLlm: false,
      usedScoreFallback: false,
    };
  }

  const topScore = chunks[0]?.score ?? null;

  if (topScore === null || !Number.isFinite(topScore) || topScore < ragMinRelevanceScore) {
    return {
      relevant: false,
      reason: `Top retrieval score was below the relevance threshold (${ragMinRelevanceScore.toFixed(2)}).`,
      topScore,
      usedLlm: false,
      usedScoreFallback: false,
    };
  }

  try {
    const llmGrade = await gradeWithLlm(normalizedQuestion, chunks);

    if (!llmGrade) {
      return {
        relevant: true,
        reason: "Retrieved context passed the score threshold.",
        topScore,
        usedLlm: false,
        usedScoreFallback: true,
      };
    }

    return {
      relevant: llmGrade.relevant,
      reason: llmGrade.reason,
      topScore,
      usedLlm: true,
      usedScoreFallback: false,
    };
  } catch {
    return {
      relevant: true,
      reason: "Retrieved context passed the score threshold.",
      topScore,
      usedLlm: false,
      usedScoreFallback: true,
    };
  }
}
