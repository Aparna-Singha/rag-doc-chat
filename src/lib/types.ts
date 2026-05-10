export type SupportedFileType = "pdf" | "txt" | "csv";

export type VectorStoreProvider = "qdrant" | "memory";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  pageLabel?: string | null;
  width?: number;
  height?: number;
}

export interface ExtractedFileContent {
  text: string;
  pages: ExtractedPage[];
  pageCount: number;
}

export interface ExtractedDocument extends ExtractedFileContent {
  fileName: string;
  fileType: SupportedFileType;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  fileName: string;
  fileType: SupportedFileType;
  chunkIndex: number;
  pageNumber?: number | null;
  snippet: string;
  text: string;
}

export interface RetrievedChunk extends DocumentChunk {
  score: number;
  sourceLabel: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface UploadResult {
  success: true;
  documentId: string;
  fileName: string;
  fileType: SupportedFileType;
  chunkCount: number;
  pageCount: number;
  storage: VectorStoreProvider;
}
