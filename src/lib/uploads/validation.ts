import { AppError } from "@/lib/errors";
import type { SupportedFileType } from "@/lib/types";

export const DEFAULT_MAX_UPLOAD_SIZE_MB = 10;
export const ACCEPTED_FILE_EXTENSIONS = [".pdf", ".txt", ".csv"] as const;
export const ACCEPTED_FILE_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
] as const;

const extensionToTypeMap: Record<string, SupportedFileType> = {
  ".pdf": "pdf",
  ".txt": "txt",
  ".csv": "csv",
};

const mimeTypeToTypeMap: Record<string, SupportedFileType> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.ms-excel": "csv",
};

function getNormalizedExtension(fileName: string): string | null {
  const trimmedFileName = fileName.trim();
  const dotIndex = trimmedFileName.lastIndexOf(".");

  if (dotIndex < 0) {
    return null;
  }

  return trimmedFileName.slice(dotIndex).toLowerCase();
}

function getNormalizedMimeType(mimeType: string | null | undefined): string | null {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  return normalizedMimeType || null;
}

export function getSupportedUploadMessage(): string {
  return "Upload a PDF, TXT, or CSV document.";
}

export function detectUploadedFileType(params: {
  fileName: string;
  mimeType?: string | null;
}): SupportedFileType {
  const normalizedExtension = getNormalizedExtension(params.fileName);

  if (!normalizedExtension || !(normalizedExtension in extensionToTypeMap)) {
    throw new AppError(
      `Unsupported file extension. ${getSupportedUploadMessage()}`,
      400,
    );
  }

  const fileTypeFromExtension = extensionToTypeMap[normalizedExtension];
  const normalizedMimeType = getNormalizedMimeType(params.mimeType);

  if (!normalizedMimeType) {
    return fileTypeFromExtension;
  }

  if (!(normalizedMimeType in mimeTypeToTypeMap)) {
    throw new AppError(
      `Unsupported file MIME type "${normalizedMimeType}". ${getSupportedUploadMessage()}`,
      400,
    );
  }

  const fileTypeFromMime = mimeTypeToTypeMap[normalizedMimeType];

  if (fileTypeFromMime !== fileTypeFromExtension) {
    throw new AppError(
      "The file extension and MIME type do not match. Please upload a valid PDF, TXT, or CSV document.",
      400,
    );
  }

  return fileTypeFromExtension;
}

export function validateUploadSize(params: {
  fileSize: number;
  maxFileSizeMb: number;
}): void {
  const maxFileSizeBytes = params.maxFileSizeMb * 1024 * 1024;

  if (params.fileSize > maxFileSizeBytes) {
    throw new AppError(
      `The selected file is too large. The maximum upload size is ${params.maxFileSizeMb} MB.`,
      400,
    );
  }
}
