import { NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";

const AGENT_NAME = "echo-browser-copilot";

export const runtime = "nodejs";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toDispatchUrl(livekitUrl: string) {
  if (livekitUrl.startsWith("wss://")) {
    return livekitUrl.replace("wss://", "https://");
  }
  if (livekitUrl.startsWith("ws://")) {
    return livekitUrl.replace("ws://", "http://");
  }
  return livekitUrl;
}

export async function POST() {
  try {
    const livekitUrl = required("LIVEKIT_URL");
    const apiKey = required("LIVEKIT_API_KEY");
    const apiSecret = required("LIVEKIT_API_SECRET");

    const roomName = `echo-panel-${Date.now()}`;
    const participantIdentity = `web-user-${crypto.randomUUID().slice(0, 8)}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: "Portfolio Demo User",
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });

    const dispatchClient = new AgentDispatchClient(
      toDispatchUrl(livekitUrl),
      apiKey,
      apiSecret,
    );

    await dispatchClient.createDispatch(roomName, AGENT_NAME, {
      metadata: JSON.stringify({
        source: "web-demo",
        route: "/",
        participantIdentity,
      }),
    });

    return NextResponse.json({
      agentName: AGENT_NAME,
      participantIdentity,
      roomName,
      token: await token.toJwt(),
      wsUrl: livekitUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate LiveKit token.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
