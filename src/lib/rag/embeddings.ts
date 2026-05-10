import { AppError } from "@/lib/errors";
import { getServerConfig } from "@/lib/server-config";
import { getGeminiClient } from "@/lib/rag/gemini";

const EMBEDDING_BATCH_SIZE = 16;
const DOCUMENT_TASK_TYPE = "RETRIEVAL_DOCUMENT";
const QUERY_TASK_TYPE = "RETRIEVAL_QUERY";

function ensureGeminiApiKey(): void {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new AppError(
      "Missing GEMINI_API_KEY. Add it to .env.local for local development or to your deployment environment before generating embeddings.",
      500,
    );
  }
}

function normalizeEmbeddingInput(text: string, label: string): string {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new AppError(`${label} cannot be empty when generating embeddings.`, 400);
  }

  return normalizedText;
}

function assertEmbeddingVectors(
  vectors: Array<number[] | undefined> | undefined,
  expectedCount: number,
): number[][] {
  if (!vectors || vectors.length !== expectedCount) {
    throw new AppError("Embedding generation returned an unexpected result.");
  }

  return vectors.map((vector) => {
    if (!vector || vector.length === 0) {
      throw new AppError("Embedding generation returned an empty vector.");
    }

    return vector;
  });
}

function toEmbeddingError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      `Gemini embedding request failed: ${error.message}`,
      502,
    );
  }

  return new AppError("Gemini embedding request failed unexpectedly.", 502);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  ensureGeminiApiKey();
  const { geminiEmbeddingModel } = getServerConfig();
  const client = getGeminiClient();
  const normalizedTexts = texts.map((text, index) =>
    normalizeEmbeddingInput(text, `Text at index ${index}`),
  );
  const vectors: number[][] = [];

  try {
    for (
      let index = 0;
      index < normalizedTexts.length;
      index += EMBEDDING_BATCH_SIZE
    ) {
      const batch = normalizedTexts.slice(index, index + EMBEDDING_BATCH_SIZE);
      const response = await client.models.embedContent({
        model: geminiEmbeddingModel,
        contents: batch,
        config: {
          taskType: DOCUMENT_TASK_TYPE,
        },
      });

      const batchVectors = assertEmbeddingVectors(
        response.embeddings?.map((embedding) => embedding.values),
        batch.length,
      );

      vectors.push(...batchVectors);
    }
  } catch (error) {
    throw toEmbeddingError(error);
  }

  return vectors;
}

export async function embedQuery(query: string): Promise<number[]> {
  ensureGeminiApiKey();
  const normalizedQuery = normalizeEmbeddingInput(query, "Query");
  const { geminiEmbeddingModel } = getServerConfig();
  const client = getGeminiClient();

  try {
    const response = await client.models.embedContent({
      model: geminiEmbeddingModel,
      contents: normalizedQuery,
      config: {
        taskType: QUERY_TASK_TYPE,
      },
    });

    const [vector] = assertEmbeddingVectors(
      response.embeddings?.map((embedding) => embedding.values),
      1,
    );

    return vector;
  } catch (error) {
    throw toEmbeddingError(error);
  }
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
