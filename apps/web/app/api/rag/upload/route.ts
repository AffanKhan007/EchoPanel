import { NextResponse } from "next/server";
import { requireRagConfig } from "@/lib/rag-service";

export const runtime = "nodejs";

function coerceFilenames(payload: unknown, fallbackNames: string[]) {
  if (!payload || typeof payload !== "object") {
    return fallbackNames;
  }

  const source = payload as {
    filenames?: unknown;
    processed_files?: unknown;
    documents?: unknown;
  };

  if (Array.isArray(source.filenames)) {
    const names = source.filenames.filter((item): item is string => typeof item === "string");
    if (names.length > 0) {
      return names;
    }
  }

  const collectionCandidates = [source.processed_files, source.documents];
  for (const candidate of collectionCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const names = candidate
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const filename = (item as { filename?: unknown }).filename;
        return typeof filename === "string" ? filename : null;
      })
      .filter((item): item is string => typeof item === "string");

    if (names.length > 0) {
      return names;
    }
  }

  return fallbackNames;
}

function coerceDocumentIds(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [] as number[];
  }

    const source = payload as {
      document_ids?: unknown;
      documentIds?: unknown;
      document_id?: unknown;
      documentId?: unknown;
      documents?: unknown;
      processed_files?: unknown;
    };

  const arrayCandidates = [source.document_ids, source.documentIds];
  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate)) {
      const ids = candidate.filter((item): item is number => typeof item === "number");
      if (ids.length > 0) {
        return ids;
      }
    }
  }

  const singleCandidates = [source.document_id, source.documentId];
  for (const candidate of singleCandidates) {
    if (typeof candidate === "number") {
      return [candidate];
    }
  }

  const collectionCandidates = [source.documents, source.processed_files];
  for (const candidate of collectionCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const ids = candidate
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const maybeId = (item as { id?: unknown; document_id?: unknown }).id;
        if (typeof maybeId === "number") {
          return maybeId;
        }

        const maybeDocumentId = (item as { id?: unknown; document_id?: unknown }).document_id;
        if (typeof maybeDocumentId === "number") {
          return maybeDocumentId;
        }

        return null;
      })
      .filter((item): item is number => typeof item === "number");

      if (ids.length > 0) {
        return ids;
      }
  }

  return [];
}

export async function POST(request: Request) {
  try {
    const { apiKey, baseUrl } = requireRagConfig();
    const incoming = await request.formData();
    const files = incoming.getAll("files").filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Please choose at least one file." }, { status: 400 });
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    console.info("rag upload forwarding", {
      baseUrl,
      count: files.length,
      names: files.map((file) => file.name),
    });

    const response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
      },
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; filenames?: string[] }
      | null;

    if (!response.ok) {
      console.error("rag upload failed", {
        baseUrl,
        error: payload?.error ?? payload?.message ?? "Document upload failed.",
        status: response.status,
      });
      return NextResponse.json(
        { error: payload?.error ?? payload?.message ?? "Document upload failed." },
        { status: 502 },
      );
    }

    const documentIds = coerceDocumentIds(payload);

    console.info("rag upload succeeded", {
      baseUrl,
      count: files.length,
      names: coerceFilenames(payload, files.map((file) => file.name)),
      documentIds,
      rawPayload: payload,
    });

    return NextResponse.json({
      filenames: coerceFilenames(payload, files.map((file) => file.name)),
      documentIds,
      message: payload?.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to upload documents right now.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
