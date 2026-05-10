import { getGeminiClient } from "@/lib/rag/gemini";
import { getServerConfig } from "@/lib/server-config";
import type { RetrievedChunk } from "@/lib/types";

const EMPTY_ANSWER =
  "I could not find this information in the uploaded document.";

const STRICT_SYSTEM_PROMPT = `
You are a document question-answering assistant.

Rules:
- Answer only using the provided document context.
- If the answer is not present in the context, say exactly: "I could not find this information in the uploaded document."
- Do not use outside knowledge.
- Do not guess.
- Be concise but helpful.
- Mention when the document context is insufficient.
`.trim();

function normalizeAnswer(answer: string | null | undefined): string {
  const normalizedAnswer = answer?.trim();

  if (!normalizedAnswer) {
    return EMPTY_ANSWER;
  }

  if (
    normalizedAnswer
      .toLowerCase()
      .includes("i could not find this information in the uploaded document")
  ) {
    return EMPTY_ANSWER;
  }

  return normalizedAnswer;
}

function formatSources(sources: RetrievedChunk[]): string {
  return sources
    .map(
      (source) =>
        `Chunk ${source.chunkIndex + 1}${source.pageNumber ? ` (page ${source.pageNumber})` : ""} from ${source.fileName}\n${source.text}`,
    )
    .join("\n\n");
}

export async function generateGroundedAnswer(params: {
  question: string;
  sources: RetrievedChunk[];
}): Promise<string> {
  if (params.sources.length === 0) {
    return EMPTY_ANSWER;
  }

  const { geminiModel } = getServerConfig();
  const client = getGeminiClient();
  const sourceText = formatSources(params.sources);

  const prompt = `
Document context:
${sourceText}

User question:
${params.question}

Answer using only the document context above.
`.trim();

  const response = await client.models.generateContent({
    model: geminiModel,
    contents: prompt,
    config: {
      systemInstruction: STRICT_SYSTEM_PROMPT,
      temperature: 0.1,
    },
  });

  return normalizeAnswer(response.text);
}
