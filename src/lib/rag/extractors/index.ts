import { AppError } from "@/lib/errors";
import { extractCsvText } from "@/lib/rag/extractors/csv";
import { extractPdfText } from "@/lib/rag/extractors/pdf";
import { extractTxtText } from "@/lib/rag/extractors/txt";
import type { ExtractedDocument, SupportedFileType } from "@/lib/types";

export async function extractDocumentFromBuffer(params: {
  buffer: Buffer;
  fileName: string;
  fileType: SupportedFileType;
}): Promise<ExtractedDocument> {
  let extractedContent;

  switch (params.fileType) {
    case "pdf":
      extractedContent = await extractPdfText(params.buffer);
      break;
    case "txt":
      extractedContent = extractTxtText(params.buffer);
      break;
    case "csv":
      extractedContent = extractCsvText(params.buffer);
      break;
    default:
      extractedContent = undefined;
  }

  if (!extractedContent || !extractedContent.text.trim()) {
    throw new AppError(
      "The uploaded document did not contain extractable text.",
      400,
    );
  }

  return {
    fileName: params.fileName,
    fileType: params.fileType,
    text: extractedContent.text,
    pages: extractedContent.pages,
    pageCount: extractedContent.pageCount,
  };
}
