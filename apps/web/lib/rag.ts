import type { RagHealthResponse, RagUploadResponse } from "@/lib/types";

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  return payload?.error ?? fallback;
}

export async function requestRagHealth(): Promise<RagHealthResponse> {
  const response = await fetch("/api/rag/health", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Unable to reach the document service."));
  }

  return (await response.json()) as RagHealthResponse;
}

export async function uploadRagDocuments(files: File[]): Promise<RagUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch("/api/rag/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Unable to upload documents."));
  }

  return (await response.json()) as RagUploadResponse;
}
