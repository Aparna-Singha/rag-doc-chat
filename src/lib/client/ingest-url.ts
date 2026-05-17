import type { IndexedSourceResult, VectorStoreProvider } from "@/lib/types";

interface IngestUrlErrorResponse {
  success?: false;
  error?: string;
}

export async function ingestUrlToWorkspace(params: {
  url: string;
  workspaceId?: string;
  storage?: VectorStoreProvider;
}): Promise<IndexedSourceResult> {
  const response = await fetch("/api/ingest-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const payload = (await response.json()) as
    | IndexedSourceResult
    | IngestUrlErrorResponse;

  if (!response.ok) {
    throw new Error(
      payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
        ? payload.error
        : "We couldn't add that URL.",
    );
  }

  return payload as IndexedSourceResult;
}
