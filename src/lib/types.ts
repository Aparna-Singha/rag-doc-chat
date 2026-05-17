export type SupportedFileType = "pdf" | "txt" | "csv";

export type SourceType = SupportedFileType | "web";

export type VectorStoreProvider = "qdrant" | "memory";

export type CorrectiveRetrievalMode =
  | "direct"
  | "corrected"
  | "insufficient_context";

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
  workspaceId: string;
  sourceId: string;
  documentId: string;
  sourceName: string;
  sourceType: SourceType;
  sourceUrl?: string | null;
  fileName?: string | null;
  fileType?: SupportedFileType | null;
  chunkIndex: number;
  pageNumber?: number | null;
  snippet: string;
  text: string;
}

export interface RetrievedChunk extends DocumentChunk {
  score: number;
  sourceLabel: string;
}

export interface RetrievalGrade {
  relevant: boolean;
  reason: string;
  topScore: number | null;
  usedLlm: boolean;
  usedScoreFallback: boolean;
}

export interface CorrectiveRagMetadata {
  enabled: true;
  initialQuery: string;
  rewrittenQuery?: string;
  initialRetrievalPassed: boolean;
  secondRetrievalUsed: boolean;
  finalRetrievalPassed: boolean;
  reason: string;
  retrievalMode: CorrectiveRetrievalMode;
}

export interface CorrectiveRagResult {
  chunks: RetrievedChunk[];
  corrective: CorrectiveRagMetadata;
}

export interface ChatSource {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  chunkIndex: number;
  text: string;
  score: number;
  page: number | null;
  url?: string;
}

export interface WorkspaceSource {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  sourceName: string;
  sourceType: SourceType;
  chunkCount: number;
  pageCount: number | null;
  url?: string;
  fileName?: string;
  fileType?: SupportedFileType;
  storage: VectorStoreProvider;
}

export interface IndexedSourceResult extends WorkspaceSource {
  success: true;
}

export interface UploadResult extends IndexedSourceResult {
  fileName: string;
  fileType: SupportedFileType;
  pageCount: number;
  sourceType: SupportedFileType;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}
