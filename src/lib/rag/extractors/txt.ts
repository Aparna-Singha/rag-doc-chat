import { normalizeDocumentText } from "@/lib/rag/text";
import { AppError } from "@/lib/errors";
import type { ExtractedFileContent } from "@/lib/types";

export function extractTxtText(buffer: Buffer): ExtractedFileContent {
  const text = normalizeDocumentText(buffer.toString("utf-8"));

  if (!text) {
    throw new AppError("The uploaded TXT file is empty.", 400);
  }

  return {
    text,
    pages: [
      {
        pageNumber: 1,
        text,
      },
    ],
    pageCount: 1,
  };
}
