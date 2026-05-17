"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { ingestUrlToWorkspace } from "@/lib/client/ingest-url";
import { uploadDocumentWithProgress } from "@/lib/client/upload-document";
import type {
  ChatSource,
  CorrectiveRagMetadata,
  IndexedSourceResult,
  SourceType,
  UploadResult,
  VectorStoreProvider,
  WorkspaceSource,
} from "@/lib/types";
import {
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  detectUploadedFileType,
  validateUploadSize,
} from "@/lib/uploads/validation";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  corrective?: CorrectiveRagMetadata;
}

interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  corrective?: CorrectiveRagMetadata;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSourceTypeLabel(sourceType: SourceType): string {
  return sourceType.toUpperCase();
}

function formatCorrectiveStatus(value: boolean): string {
  return value ? "Passed" : "Failed";
}

function formatSourceLocation(source: { page: number | null; url?: string }): string | null {
  if (source.page) {
    return `page ${source.page}`;
  }

  if (source.url) {
    try {
      const parsedUrl = new URL(source.url);
      return `${parsedUrl.hostname}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`;
    } catch {
      return source.url;
    }
  }

  return null;
}

function upsertWorkspaceSources(
  currentSources: WorkspaceSource[],
  nextSource: WorkspaceSource,
): WorkspaceSource[] {
  const remainingSources = currentSources.filter(
    (source) => source.sourceId !== nextSource.sourceId,
  );

  return [...remainingSources, nextSource];
}

function SourceTypeBadge({ sourceType }: { sourceType: SourceType }) {
  return (
    <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
      {formatSourceTypeLabel(sourceType)}
    </span>
  );
}

function SourceCard({ source, index }: { source: ChatSource; index: number }) {
  const sourceLocation = formatSourceLocation(source);

  return (
    <article className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceTypeBadge sourceType={source.sourceType} />
          <span className="text-sm font-semibold text-[color:var(--color-ink)]">
            {source.sourceName}
          </span>
        </div>
        <span className="text-xs text-[color:var(--color-muted)]">
          Source {index + 1}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted)]">
        <span>chunk {source.chunkIndex + 1}</span>
        <span>score {source.score.toFixed(3)}</span>
        {sourceLocation ? <span>{sourceLocation}</span> : null}
      </div>
      {source.url ? (
        <p className="mb-2 truncate text-xs text-[color:var(--color-muted)]">
          {source.url}
        </p>
      ) : null}
      <p className="text-sm leading-7 text-[color:var(--color-ink)]/80">
        {source.text}
      </p>
    </article>
  );
}

function WorkspaceSourceRow({ source }: { source: WorkspaceSource }) {
  const sourceLocation = source.url
    ? formatSourceLocation({ page: null, url: source.url })
    : null;

  return (
    <article className="rounded-2xl border border-[color:var(--color-border)] bg-white px-4 py-4 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SourceTypeBadge sourceType={source.sourceType} />
            <p className="truncate text-sm font-semibold text-[color:var(--color-ink)]">
              {source.sourceName}
            </p>
          </div>
          {sourceLocation ? (
            <p className="mt-2 truncate text-xs text-[color:var(--color-muted)]">
              {sourceLocation}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted)]">
            <span>{source.chunkCount} chunks</span>
            {source.pageCount ? <span>{source.pageCount} pages</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function CorrectiveRagCard({
  corrective,
}: {
  corrective: CorrectiveRagMetadata;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]/80 p-4">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-[color:var(--color-muted)] uppercase">
        Corrective RAG
      </p>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-[color:var(--color-ink)]/85">
        <p>
          Initial retrieval:{" "}
          <span className="font-medium">
            {formatCorrectiveStatus(corrective.initialRetrievalPassed)}
          </span>
        </p>
        <p>
          Query rewritten:{" "}
          <span className="font-medium">
            {corrective.rewrittenQuery ? "Yes" : "No"}
          </span>
        </p>
        <p>
          Final retrieval:{" "}
          <span className="font-medium">
            {formatCorrectiveStatus(corrective.finalRetrievalPassed)}
          </span>
        </p>
        {corrective.rewrittenQuery ? (
          <p className="text-xs leading-6 text-[color:var(--color-muted)]">
            Rewritten query: {corrective.rewrittenQuery}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatTurn }) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-3xl rounded-[28px] px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)] ${
          isAssistant
            ? "border border-[color:var(--color-border)] bg-white text-[color:var(--color-ink)]"
            : "bg-[color:var(--color-accent-strong)] text-white"
        }`}
      >
        <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
        {isAssistant && message.sources && message.sources.length > 0 ? (
          <div className="mt-4">
            <p className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-[color:var(--color-muted)] uppercase">
              Source chunks
            </p>
            <div className="grid gap-3">
              {message.sources.map((source, index) => (
                <SourceCard
                  key={`${message.id}-${source.sourceId}-${source.chunkIndex}-${index}`}
                  source={source}
                  index={index}
                />
              ))}
            </div>
          </div>
        ) : null}
        {isAssistant && message.corrective ? (
          <CorrectiveRagCard corrective={message.corrective} />
        ) : null}
      </div>
    </div>
  );
}

export function AskMyDocApp() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceStorage, setWorkspaceStorage] =
    useState<VectorStoreProvider | null>(null);
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceSource[]>([]);
  const [latestIndexedSource, setLatestIndexedSource] =
    useState<IndexedSourceResult | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<
    "uploading" | "processing" | null
  >(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isPending, startTransition] = useTransition();
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatComposerRef = useRef<HTMLTextAreaElement>(null);

  const scrollMessagesToBottom = useEffectEvent((behavior: ScrollBehavior) => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior,
    });
  });

  useEffect(() => {
    scrollMessagesToBottom(messages.length > 1 ? "smooth" : "auto");
  }, [messages.length]);

  useEffect(() => {
    if (workspaceSources.length === 0) {
      return;
    }

    chatComposerRef.current?.focus();
    chatComposerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [workspaceSources.length]);

  function applySelectedFile(file: File | null): boolean {
    setUploadError(null);
    setUploadSuccess(null);

    if (!file) {
      setSelectedFile(null);
      return false;
    }

    try {
      detectUploadedFileType({
        fileName: file.name,
        mimeType: file.type,
      });
      validateUploadSize({
        fileSize: file.size,
        maxFileSizeMb: DEFAULT_MAX_UPLOAD_SIZE_MB,
      });
      setSelectedFile(file);
      return true;
    } catch (error) {
      setSelectedFile(null);
      setUploadError(
        error instanceof Error
          ? error.message
          : "The selected file is not supported.",
      );
      return false;
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!applySelectedFile(file)) {
      event.target.value = "";
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setIsDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    const { files } = event.dataTransfer;

    if (!files || files.length === 0) {
      return;
    }

    if (files.length > 1) {
      setUploadError("Please upload one PDF, TXT, or CSV file at a time.");
      return;
    }

    applySelectedFile(files[0] ?? null);
  }

  function rememberIndexedSource(source: IndexedSourceResult | UploadResult) {
    startTransition(() => {
      setWorkspaceId(source.workspaceId);
      setWorkspaceStorage(source.storage);
      setLatestIndexedSource(source);
      setWorkspaceSources((current) => upsertWorkspaceSources(current, source));
      setQuestion("");
    });
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setUploadError("Choose a PDF, TXT, or CSV file before uploading.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    setUrlError(null);
    setUrlSuccess(null);
    setUploadProgress(0);
    setUploadStatus("uploading");
    setChatError(null);

    try {
      const payload = await uploadDocumentWithProgress(
        selectedFile,
        ({ progress, status }) => {
          setUploadProgress(progress);
          setUploadStatus(status);
        },
        {
          workspaceId: workspaceId ?? undefined,
          storage: workspaceStorage ?? undefined,
        },
      );

      rememberIndexedSource(payload);
      setUploadSuccess(
        workspaceSources.length > 0
          ? `Added ${payload.sourceName} to the workspace.`
          : `Indexed ${payload.sourceName} into the workspace.`,
      );
      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Upload failed.",
      );
      setUploadProgress(0);
      setUploadStatus(null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAddUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = urlInput.trim();

    if (!trimmedUrl) {
      setUrlError("Paste a public web page URL before adding it.");
      return;
    }

    setIsAddingUrl(true);
    setUrlError(null);
    setUrlSuccess(null);
    setUploadError(null);
    setUploadSuccess(null);
    setChatError(null);

    try {
      const payload = await ingestUrlToWorkspace({
        url: trimmedUrl,
        workspaceId: workspaceId ?? undefined,
        storage: workspaceStorage ?? undefined,
      });

      rememberIndexedSource(payload);
      setUrlInput("");
      setUrlSuccess(
        workspaceSources.length > 0
          ? `Added ${payload.sourceName} to the workspace.`
          : `Indexed ${payload.sourceName} into the workspace.`,
      );
    } catch (error) {
      setUrlError(
        error instanceof Error ? error.message : "We couldn't add that URL.",
      );
    } finally {
      setIsAddingUrl(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (workspaceSources.length === 0) {
      setChatError("Add a source before asking questions.");
      return;
    }

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setChatError("Enter a question to search the active workspace.");
      return;
    }

    const userMessage: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedQuestion,
    };

    setChatError(null);
    setQuestion("");
    setIsAsking(true);

    startTransition(() => {
      setMessages((current) => [...current, userMessage]);
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: workspaceId ?? undefined,
          documentId: latestIndexedSource?.documentId,
          storage: workspaceStorage ?? undefined,
          question: trimmedQuestion,
        }),
      });
      const payload = (await response.json()) as ChatResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Question answering failed.");
      }

      const assistantMessage: ChatTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.answer,
        sources: payload.sources,
        corrective: payload.corrective,
      };

      startTransition(() => {
        setMessages((current) => [...current, assistantMessage]);
      });
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Question answering failed.",
      );
    } finally {
      setIsAsking(false);
    }
  }

  function handleClearWorkspace() {
    setWorkspaceId(null);
    setWorkspaceStorage(null);
    setWorkspaceSources([]);
    setLatestIndexedSource(null);
    setSelectedFile(null);
    setMessages([]);
    setQuestion("");
    setUrlInput("");
    setUploadError(null);
    setUploadSuccess(null);
    setUrlError(null);
    setUrlSuccess(null);
    setUploadProgress(0);
    setUploadStatus(null);
    setChatError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const suggestions = [
    "Summarize the main argument of these sources.",
    "What are the key numbers or metrics mentioned here?",
    "List the most important takeaways with citations.",
  ];
  const totalChunks = workspaceSources.reduce(
    (chunkCount, source) => chunkCount + source.chunkCount,
    0,
  );
  const workspaceLabel =
    workspaceSources.length === 0
      ? "No workspace sources yet"
      : workspaceSources.length === 1
        ? workspaceSources[0]?.sourceName ?? "1 source in workspace"
        : `${workspaceSources.length} sources in workspace`;
  const latestSourceLabel =
    latestIndexedSource?.sourceName ?? "No source indexed yet";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <section className="relative w-full overflow-hidden rounded-[36px] border border-white/50 bg-[color:var(--color-panel)] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(30,136,229,0.12),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.14),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.75),_rgba(255,255,255,0.45))]" />
        <div className="relative z-10 min-w-0">
          <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className="inline-flex rounded-full border border-[color:var(--color-border)] bg-white/80 px-4 py-1.5 text-xs font-semibold tracking-[0.25em] text-[color:var(--color-accent-strong)] uppercase">
                Grounded document Q and A
              </span>
              <h1 className="mt-5 max-w-2xl text-4xl leading-tight font-semibold tracking-tight text-[color:var(--color-ink)] sm:text-5xl">
                Ask My Doc RAG
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-[color:var(--color-muted)] sm:text-lg">
                Upload PDF, TXT, and CSV files, add public web pages, and ask grounded questions across the active workspace.
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--color-muted)] sm:text-base">
                The app extracts text, creates chunks, stores Gemini embeddings,
                retrieves the most relevant passages from the active workspace,
                and answers only from that retrieved context.
              </p>
            </div>

            <div className="grid w-full max-w-md gap-3 rounded-[28px] border border-[color:var(--color-border)] bg-white/75 p-5 text-sm text-[color:var(--color-ink)] shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">Supported sources</span>
                <span className="text-[color:var(--color-muted)]">PDF, TXT, CSV, WEB</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">Vector storage</span>
                <span className="text-[color:var(--color-muted)]">
                  Qdrant with in-memory fallback
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">Workspace mode</span>
                <span className="text-[color:var(--color-muted)]">Multi-source grounded chat</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
            <section className="min-w-0 w-full max-w-full overflow-hidden rounded-[30px] border border-[color:var(--color-border)] bg-white/80 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)] lg:max-w-[380px]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-[color:var(--color-ink)]">
                    Upload a PDF, TXT, or CSV document
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[color:var(--color-muted)]">
                    Each source is extracted, chunked, embedded, and indexed into the active workspace before chat uses it.
                  </p>
                </div>

                {workspaceSources.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleClearWorkspace}
                    className="shrink-0 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-semibold tracking-[0.16em] text-[color:var(--color-accent-strong)] uppercase transition hover:border-[color:var(--color-accent-strong)] hover:bg-[color:var(--color-accent-soft)]"
                  >
                    Clear workspace
                  </button>
                ) : null}
              </div>

              <form className="mt-6 grid min-w-0 gap-4" onSubmit={handleUpload}>
                <div
                  className={`min-w-0 overflow-hidden rounded-[24px] border border-dashed px-5 py-6 transition ${
                    isDragActive
                      ? "border-[color:var(--color-accent-strong)] bg-white shadow-[0_18px_40px_rgba(15,118,110,0.12)]"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-paper)] hover:border-[color:var(--color-accent-strong)] hover:bg-white"
                  }`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv,application/csv,application/vnd.ms-excel"
                    className="sr-only"
                    name="file"
                    type="file"
                    onChange={handleFileChange}
                  />
                  <div className="flex min-w-0 flex-col gap-4">
                    <div>
                      <p className="text-sm font-medium text-[color:var(--color-ink)]">
                        Upload a PDF, TXT, or CSV document
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[color:var(--color-muted)]">
                        Drag and drop a file here, or use the file picker. Maximum size: {DEFAULT_MAX_UPLOAD_SIZE_MB} MB.
                      </p>
                    </div>

                    <div className="min-w-0 overflow-hidden rounded-[22px] bg-white px-4 py-4 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)]">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
                            Selected file
                          </p>
                          <p className="mt-1 truncate text-sm text-[color:var(--color-ink)]">
                            {selectedFile ? selectedFile.name : "No file selected yet"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex w-full items-center justify-center rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold text-[color:var(--color-ink)] transition hover:border-[color:var(--color-accent-strong)] hover:bg-[color:var(--color-accent-soft)] sm:w-auto sm:shrink-0"
                        >
                          Choose file
                        </button>
                      </div>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted)]">
                        <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-[color:var(--color-accent-strong)]">
                          PDF
                        </span>
                        <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-[color:var(--color-accent-strong)]">
                          TXT
                        </span>
                        <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-[color:var(--color-accent-strong)]">
                          CSV
                        </span>
                        <span>{selectedFile ? formatBytes(selectedFile.size) : "Ready for upload"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="inline-flex w-full items-center justify-center rounded-full bg-[color:var(--color-accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading
                    ? uploadStatus === "uploading"
                      ? "Uploading..."
                      : "Extracting and indexing..."
                    : "Upload and index"}
                </button>

                {isUploading ? (
                  <div className="rounded-2xl border border-[color:var(--color-border)] bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-[color:var(--color-ink)]">
                        {uploadStatus === "uploading"
                          ? "Uploading file"
                          : "Extracting, chunking, embedding, and indexing"}
                      </span>
                      <span className="text-[color:var(--color-muted)]">
                        {uploadProgress}%
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-accent-soft)]">
                      <div
                        className="h-full rounded-full bg-[color:var(--color-accent-strong)] transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {uploadError ? (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {uploadError}
                  </p>
                ) : null}
                {uploadSuccess ? (
                  <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {uploadSuccess}
                  </p>
                ) : null}
              </form>

              <div className="mt-6 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-paper)] p-5">
                <h3 className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
                  Add a public web page
                </h3>
                <form className="mt-4 grid gap-3" onSubmit={handleAddUrl}>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(event) => {
                      setUrlInput(event.target.value);
                      setUrlError(null);
                      setUrlSuccess(null);
                    }}
                    placeholder="Paste a public web page URL"
                    className="w-full rounded-2xl border border-[color:var(--color-border)] bg-white px-4 py-3 text-sm text-[color:var(--color-ink)] outline-none transition placeholder:text-[color:var(--color-muted)] focus:border-[color:var(--color-accent-strong)]"
                  />
                  <button
                    type="submit"
                    disabled={isAddingUrl || !urlInput.trim()}
                    className="inline-flex w-full items-center justify-center rounded-full border border-[color:var(--color-border)] bg-white px-5 py-3 text-sm font-semibold text-[color:var(--color-ink)] transition hover:border-[color:var(--color-accent-strong)] hover:bg-[color:var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAddingUrl ? "Fetching and indexing..." : "Add URL"}
                  </button>
                </form>
                {urlError ? (
                  <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {urlError}
                  </p>
                ) : null}
                {urlSuccess ? (
                  <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {urlSuccess}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 min-w-0 overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-paper)] p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
                    Workspace sources
                  </h3>
                  {workspaceSources.length > 0 ? (
                    <span className="rounded-full bg-white px-3 py-1 text-xs text-[color:var(--color-muted)] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]">
                      {workspaceSources.length}
                    </span>
                  ) : null}
                </div>

                {workspaceSources.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {workspaceSources.map((source) => (
                      <WorkspaceSourceRow key={source.sourceId} source={source} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3">
                    <p className="rounded-2xl border border-[color:var(--color-border)] bg-white px-4 py-4 text-sm leading-7 text-[color:var(--color-muted)]">
                      No sources are indexed in this workspace yet.
                    </p>
                    <div className="grid gap-3">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setQuestion(suggestion)}
                          className="rounded-2xl border border-[color:var(--color-border)] bg-white px-4 py-3 text-left text-sm leading-7 text-[color:var(--color-ink)] transition hover:border-[color:var(--color-accent-strong)] hover:bg-[color:var(--color-accent-soft)]"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-[640px] min-w-0 w-full flex-col overflow-hidden rounded-[30px] border border-[color:var(--color-border)] bg-white/82 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--color-border)] px-6 py-5">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-[color:var(--color-ink)]">
                    Grounded chat
                  </h2>
                  <p className="mt-1 text-sm leading-7 text-[color:var(--color-muted)]">
                    Answers are generated from retrieved chunks across the active workspace sources only.
                  </p>
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted)]">
                    <span className="rounded-full bg-[color:var(--color-paper)] px-3 py-1 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]">
                      Active workspace: {workspaceLabel}
                    </span>
                    {workspaceSources.length > 0 ? (
                      <span className="rounded-full bg-[color:var(--color-paper)] px-3 py-1 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]">
                        {totalChunks} chunks indexed
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-full bg-[color:var(--color-accent-soft)] px-3 py-1.5 text-xs font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
                  {workspaceSources.length > 0 ? "Ready" : "Waiting for sources"}
                </div>
              </div>

              <div ref={messagesRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
                {messages.length > 0 ? (
                  <div className="grid gap-4">
                    {messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                  </div>
                ) : (
                  <div className="grid h-full place-items-center">
                    <div className="max-w-xl rounded-[32px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-paper)] px-8 py-10 text-center">
                      <p className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-accent-strong)] uppercase">
                        Workspace flow
                      </p>
                      <h3 className="mt-4 text-3xl font-semibold text-[color:var(--color-ink)]">
                        {workspaceSources.length > 0
                          ? "Your workspace is indexed. Ask the next question."
                          : "Upload a file or add a public page to begin the RAG pipeline."}
                      </h3>
                      <p className="mt-4 text-base leading-8 text-[color:var(--color-muted)]">
                        Extraction, chunking, embeddings, workspace retrieval, corrective RAG checks, and grounded generation all happen on the server before an answer reaches the chat.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-[color:var(--color-border)] px-6 py-5">
                <form className="grid min-w-0 gap-4" onSubmit={handleAsk}>
                  <textarea
                    ref={chatComposerRef}
                    className="min-h-32 w-full resize-none rounded-[28px] border border-[color:var(--color-border)] bg-[color:var(--color-paper)] px-5 py-4 text-sm leading-7 text-[color:var(--color-ink)] outline-none transition placeholder:text-[color:var(--color-muted)] focus:border-[color:var(--color-accent-strong)] focus:bg-white"
                    disabled={workspaceSources.length === 0 || isAsking}
                    placeholder={
                      workspaceSources.length > 0
                        ? "Ask a question about the active workspace..."
                        : "Upload a file or add a public page first to unlock grounded chat."
                    }
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                  />

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-7 text-[color:var(--color-muted)]">
                      {workspaceSources.length > 0
                        ? `Questions are answered only from the active workspace sources. Latest source: ${latestSourceLabel}.`
                        : "Add a source first to unlock workspace-grounded answers."}
                    </p>
                    <button
                      type="submit"
                      disabled={workspaceSources.length === 0 || !question.trim() || isAsking}
                      className="inline-flex w-full items-center justify-center rounded-full bg-[color:var(--color-ink)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {isAsking ? "Searching and answering..." : "Ask My Doc"}
                    </button>
                  </div>

                  {chatError ? (
                    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {chatError}
                    </p>
                  ) : null}
                  {isPending ? (
                    <p className="text-xs tracking-[0.18em] text-[color:var(--color-muted)] uppercase">
                      Updating interface...
                    </p>
                  ) : null}
                </form>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
