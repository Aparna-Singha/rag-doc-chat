import { getGeminiClient } from "@/lib/rag/gemini";
import { getServerConfig } from "@/lib/server-config";

const QUERY_REWRITE_SYSTEM_PROMPT = `
You rewrite user questions into better document-retrieval search queries.

Rules:
- Keep the meaning the same.
- Do not answer the question.
- Do not add outside facts or assumptions.
- Prefer a short, searchable query.
- Return plain text only with no bullets, labels, or quotes.
`.trim();

function normalizeRewrite(
  question: string,
  rewrittenQuery: string | null | undefined,
): string {
  const normalizedRewrite = rewrittenQuery?.trim();

  if (!normalizedRewrite) {
    return question;
  }

  return normalizedRewrite.replace(/\s+/g, " ");
}

export async function rewriteQueryForRetrieval(
  question: string,
): Promise<string> {
  const normalizedQuestion = question.trim();

  if (!normalizedQuestion) {
    return question;
  }

  try {
    const { geminiModel } = getServerConfig();
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: `Rewrite this user question into a better search query for retrieving passages from the same active workspace sources:\n\n${normalizedQuestion}`,
      config: {
        systemInstruction: QUERY_REWRITE_SYSTEM_PROMPT,
        temperature: 0.2,
      },
    });

    return normalizeRewrite(normalizedQuestion, response.text);
  } catch {
    return normalizedQuestion;
  }
}
