import type { UploadResult } from "@/lib/types";

export interface UploadProgressState {
  progress: number;
  status: "uploading" | "processing";
}

interface UploadErrorResponse {
  success?: false;
  error?: string;
}

export function uploadDocumentWithProgress(
  file: File,
  onProgress: (state: UploadProgressState) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();

    formData.append("file", file);
    request.open("POST", "/api/upload");
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        onProgress({ progress: 10, status: "uploading" });
        return;
      }

      const progress = Math.min(
        90,
        Math.max(5, Math.round((event.loaded / event.total) * 90)),
      );

      onProgress({
        progress,
        status: "uploading",
      });
    };

    request.upload.onloadend = () => {
      onProgress({
        progress: 95,
        status: "processing",
      });
    };

    request.onerror = () => {
      reject(new Error("The upload failed. Please try again."));
    };

    request.onabort = () => {
      reject(new Error("The upload was canceled."));
    };

    request.onload = () => {
      let payload: UploadResult | UploadErrorResponse | null =
        request.response as UploadResult | UploadErrorResponse | null;

      if (!payload && request.responseText) {
        try {
          payload = JSON.parse(request.responseText) as
            | UploadResult
            | UploadErrorResponse;
        } catch {
          payload = null;
        }
      }

      if (
        request.status >= 200 &&
        request.status < 300 &&
        payload &&
        "success" in payload &&
        payload.success === true
      ) {
        onProgress({
          progress: 100,
          status: "processing",
        });
        resolve(payload);
        return;
      }

      const errorMessage =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "The upload failed. Please try again.";

      reject(new Error(errorMessage));
    };

    onProgress({
      progress: 5,
      status: "uploading",
    });
    request.send(formData);
  });
}
