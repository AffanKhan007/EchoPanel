import { NextResponse } from "next/server";
import { requireRagConfig } from "@/lib/rag-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { apiKey, baseUrl } = requireRagConfig();
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      headers: {
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Document service health check failed." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reach the document service.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
