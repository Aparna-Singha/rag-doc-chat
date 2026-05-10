import { z } from "zod";

import { AppError } from "@/lib/errors";
import { DEFAULT_MAX_UPLOAD_SIZE_MB } from "@/lib/uploads/validation";

function normalizeOptionalEnvValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

const serverConfigSchema = z.object({
  geminiApiKey: z
    .string()
    .min(
      1,
      "Missing GEMINI_API_KEY. Add it to .env.local for local development or to your deployment environment before calling Gemini.",
    ),
  geminiModel: z.string().min(1).default("gemini-2.5-flash"),
  geminiEmbeddingModel: z.string().min(1).default("gemini-embedding-001"),
  qdrantUrl: z
    .string()
    .url("QDRANT_URL must be a valid URL when provided.")
    .optional(),
  qdrantApiKey: z.string().optional(),
  qdrantCollectionName: z.string().min(1).default("ask_my_doc_rag"),
  ragTopK: z.coerce.number().int().positive().default(5),
  maxFileSizeMb: z.coerce.number().positive().default(DEFAULT_MAX_UPLOAD_SIZE_MB),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

let cachedConfig: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsedConfig = serverConfigSchema.safeParse({
    geminiApiKey: normalizeOptionalEnvValue(process.env.GEMINI_API_KEY),
    geminiModel: normalizeOptionalEnvValue(process.env.GEMINI_MODEL),
    geminiEmbeddingModel: normalizeOptionalEnvValue(
      process.env.GEMINI_EMBEDDING_MODEL,
    ),
    qdrantUrl: normalizeOptionalEnvValue(process.env.QDRANT_URL),
    qdrantApiKey: normalizeOptionalEnvValue(process.env.QDRANT_API_KEY),
    qdrantCollectionName: normalizeOptionalEnvValue(
      process.env.QDRANT_COLLECTION_NAME,
    ),
    ragTopK: process.env.RAG_TOP_K,
    maxFileSizeMb: process.env.MAX_FILE_SIZE_MB,
  });

  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    throw new AppError(
      issue?.message ?? "Invalid server configuration. Check .env.local.",
      500,
    );
  }

  cachedConfig = parsedConfig.data;
  return cachedConfig;
}
