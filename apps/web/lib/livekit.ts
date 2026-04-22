import type { TokenResponse } from "@/lib/types";

export async function requestLiveKitToken(): Promise<TokenResponse> {
  const response = await fetch("/api/livekit-token", {
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(payload?.error ?? "Unable to fetch LiveKit token.");
  }

  return (await response.json()) as TokenResponse;
}

