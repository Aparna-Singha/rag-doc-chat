import { AppError } from "@/lib/errors";
import { extractCsvText } from "@/lib/rag/extractors/csv";
import { extractPdfText } from "@/lib/rag/extractors/pdf";
import { extractTxtText } from "@/lib/rag/extractors/txt";
import { detectUploadedFileType } from "@/lib/uploads/validation";
import type { ExtractedDocument, SupportedFileType } from "@/lib/types";

interface ExtractTextFromFileParams {
  fileName: string;
  mimeType?: string | null;
  buffer: Buffer;
}

async function extractByFileType(
  fileType: SupportedFileType,
  buffer: Buffer,
) {
  switch (fileType) {
    case "pdf":
      return extractPdfText(buffer);
    case "txt":
      return extractTxtText(buffer);
    case "csv":
      return extractCsvText(buffer);
    default:
      throw new AppError("Unsupported file type.", 400);
  }
}

export async function extractTextFromFile(
  params: ExtractTextFromFileParams,
): Promise<ExtractedDocument> {
  const fileType = detectUploadedFileType({
    fileName: params.fileName,
    mimeType: params.mimeType,
  });
  const extractedContent = await extractByFileType(fileType, params.buffer);

  if (!extractedContent.text.trim()) {
    throw new AppError(
      "The uploaded document did not contain extractable text.",
      400,
    );
  }

  return {
    fileName: params.fileName,
    fileType,
    text: extractedContent.text,
    pages: extractedContent.pages,
    pageCount: extractedContent.pageCount,
  };
}
