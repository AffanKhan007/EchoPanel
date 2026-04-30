"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  RpcError,
  Track,
  type RpcInvocationData,
  type TrackPublication,
} from "livekit-client";
import { requestLiveKitToken } from "@/lib/livekit";
import type { FilterState, PageContextPayload, TranscriptEntry } from "@/lib/types";
import { VoiceCopilotPanel } from "@/components/voice-copilot-panel";

type UiSnapshot = {
  filters: FilterState;
  contextLabel: string | null;
};

const FILTERABLE_FIELDS = new Set(["category", "status", "search"]);
const AUDIO_CAPTURE_OPTIONS = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

function describeConnectionState(state: ConnectionState | string) {
  if (state === ConnectionState.Connected) {
    return "connected";
  }
  if (state === ConnectionState.Connecting) {
    return "connecting";
  }
  if (state === ConnectionState.Reconnecting) {
    return "reconnecting";
  }
  return "disconnected";
}

export function DemoShell() {
  const [filters, setFilters] = useState<FilterState>({
    category: "All",
    status: "All",
    search: "",
  });
  const [highlightedWidget, setHighlightedWidget] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [connectionState, setConnectionState] = useState("disconnected");
  const [agentState, setAgentState] = useState("waiting");
  const [agentIdentity, setAgentIdentity] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPrepared, setIsPrepared] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [contextLabel, setContextLabel] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const agentIdentityRef = useRef<string | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);
  const prepareStartedRef = useRef(false);
  const transcriptCreatedAtRef = useRef<Record<string, number>>({});
  const sessionActiveRef = useRef(false);
  const uiRef = useRef<UiSnapshot>({
    filters,
    contextLabel,
  });

  useEffect(() => {
    uiRef.current = {
      filters,
      contextLabel,
    };
  }, [filters, contextLabel]);

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    if (!highlightedWidget) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHighlightedWidget((current) => (current === highlightedWidget ? null : current));
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [highlightedWidget]);

  useEffect(() => {
    if (prepareStartedRef.current) {
      return;
    }

    prepareStartedRef.current = true;
    void ensurePreparedRoom();
  }, []);

  function getUiStage() {
    if (!isPrepared) {
      return "Preparing";
    }
    if (!sessionActive) {
      return agentIdentity ? "Agent joined" : "Waiting for agent";
    }
    if (agentState === "speaking") {
      return "Speaking";
    }
    if (agentState === "thinking") {
      return "Responding";
    }

    const latestUserEntry = [...transcript]
      .reverse()
      .find((entry) => entry.role === "user");

    if (latestUserEntry && !latestUserEntry.isFinal) {
      return "Listening";
    }

    const latestEntry = transcript[transcript.length - 1];
    if (
      latestUserEntry &&
      latestUserEntry.isFinal &&
      latestEntry?.id === latestUserEntry.id &&
      agentState !== "speaking" &&
      agentState !== "thinking"
    ) {
      return "Finalizing";
    }

    if (agentState === "ready" || agentState === "listening") {
      return "Listening";
    }

    return "Starting";
  }

  function buildPageContext(): PageContextPayload {
    return {
      route: "/",
      pageTitle: "AI Assistant",
      visibleWidgets: [
        "assistant-orb",
        "live-transcript",
        "status-indicator",
        "voice-controls",
      ],
      activeFilters: uiRef.current.filters,
      selectedEntity: uiRef.current.contextLabel,
    };
  }

  function upsertTranscriptEntry(
    participantIdentity: string,
    segmentId: string,
    text: string,
    isFinal: boolean,
  ) {
    setTranscript((current) => {
      const key = `${participantIdentity}:${segmentId}`;
      const existingIndex = current.findIndex((entry) => entry.id === key);

      if (!transcriptCreatedAtRef.current[key]) {
        transcriptCreatedAtRef.current[key] = Date.now();
      }

      const nextEntry: TranscriptEntry = {
        id: key,
        role:
          roomRef.current?.localParticipant.identity === participantIdentity ? "user" : "agent",
        speaker:
          roomRef.current?.localParticipant.identity === participantIdentity ? "You" : "Assistant",
        text,
        isFinal,
        createdAt: transcriptCreatedAtRef.current[key],
      };

      const next = [...current];
      if (existingIndex === -1) {
        next.push(nextEntry);
      } else {
        next[existingIndex] = nextEntry;
      }

      return next
        .filter((entry) => entry.text.trim().length > 0)
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-30);
    });
  }

  function deriveAgentState(participant?: Participant | RemoteParticipant | null) {
    if (!participant) {
      return roomRef.current ? "waiting" : "disconnected";
    }

    const rawState = participant.attributes["lk.agent.state"];
    if (!rawState || rawState === "initializing") {
      return "connecting";
    }
    if (rawState === "idle") {
      return "ready";
    }
    return rawState;
  }

  function findLikelyAgent(room: Room) {
    const participants = Array.from(room.remoteParticipants.values());
    return (
      participants.find((participant) => participant.attributes["lk.agent.state"]) ??
      participants.find((participant) => participant.identity.includes("agent")) ??
      participants[0] ??
      null
    );
  }

  function syncAgentParticipant(participant?: Participant | RemoteParticipant | null) {
    if (!participant) {
      agentIdentityRef.current = null;
      setAgentIdentity(null);
      setAgentState(roomRef.current ? "waiting" : "disconnected");
      return;
    }

    agentIdentityRef.current = participant.identity;
    setAgentIdentity(participant.identity);
    setAgentState(deriveAgentState(participant));
  }

  function clearAudioElements() {
    const host = audioHostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = "";
  }

  function setRemoteAudioEnabled(enabled: boolean) {
    const host = audioHostRef.current;
    if (!host) {
      return;
    }

    host.querySelectorAll("audio").forEach((node) => {
      const element = node as HTMLAudioElement;
      element.muted = !enabled;
      if (enabled) {
        void element.play().catch(() => undefined);
      } else {
        element.pause();
      }
    });
  }

  async function disconnectRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    preparePromiseRef.current = null;
    prepareStartedRef.current = false;

    if (room) {
      try {
        await room.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup.
      }
    }

    clearAudioElements();
    setConnectionState("disconnected");
    setAgentState("disconnected");
    setAgentIdentity(null);
    setIsMuted(true);
    setIsPrepared(false);
    setSessionActive(false);
    setContextLabel(null);
    setTranscript([]);
  }

  function registerRpcHandlers(room: Room) {
    room.registerRpcMethod("getCurrentPageContext", async () => {
      return JSON.stringify(buildPageContext());
    });

    room.registerRpcMethod("applyFilter", async (data: RpcInvocationData) => {
      try {
        const payload = JSON.parse(data.payload) as {
          field?: string;
          op?: string;
          value?: string;
        };

        const field = payload.field?.trim() ?? "";
        if (!FILTERABLE_FIELDS.has(field)) {
          throw new RpcError(1500, `Unsupported filter field: ${field}`);
        }

        const nextValue = String(payload.value ?? "").trim();
        const nextFilters: FilterState = {
          ...uiRef.current.filters,
          [field]:
            field === "search"
              ? nextValue
              : nextValue.length === 0
                ? "All"
                : nextValue,
        } as FilterState;

        setFilters(nextFilters);
        setContextLabel(nextValue ? `${field}: ${nextValue}` : null);

        return JSON.stringify({
          success: true,
          activeFilters: nextFilters,
        });
      } catch (error) {
        if (error instanceof RpcError) {
          throw error;
        }
        throw new RpcError(1500, "Could not apply filter.");
      }
    });

    room.registerRpcMethod("openPanel", async (data: RpcInvocationData) => {
      try {
        const payload = JSON.parse(data.payload) as { panel?: string };
        const panel = payload.panel ?? "transcript";
        const widgetMap: Record<string, string> = {
          details: "live-transcript",
          alerts: "status-indicator",
          insights: "assistant-orb",
          transcript: "live-transcript",
          status: "status-indicator",
          orb: "assistant-orb",
        };
        const target = widgetMap[panel];

        if (!target) {
          throw new RpcError(1500, "Unsupported panel requested.");
        }

        setHighlightedWidget(target);

        return JSON.stringify({
          success: true,
          panel,
        });
      } catch (error) {
        if (error instanceof RpcError) {
          throw error;
        }
        throw new RpcError(1500, "Could not open the requested panel.");
      }
    });

    room.registerRpcMethod("highlightWidget", async (data: RpcInvocationData) => {
      try {
        const payload = JSON.parse(data.payload) as { widgetId?: string };
        const widgetId = payload.widgetId ?? "";

        if (
          !["assistant-orb", "live-transcript", "status-indicator", "voice-controls"].includes(
            widgetId,
          )
        ) {
          throw new RpcError(1500, "Unsupported widget requested.");
        }

        setHighlightedWidget(widgetId);

        return JSON.stringify({
          success: true,
          widgetId,
        });
      } catch (error) {
        if (error instanceof RpcError) {
          throw error;
        }
        throw new RpcError(1500, "Could not highlight the requested widget.");
      }
    });
  }

  function attachRoomHandlers(room: Room) {
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      const nextConnectionState = describeConnectionState(state);
      setConnectionState(nextConnectionState);

      if (nextConnectionState !== "connected") {
        setAgentState("disconnected");
        setIsPrepared(false);
      } else {
        setIsPrepared(true);
        if (!agentIdentityRef.current) {
          setAgentState("waiting");
        }
      }
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.identity !== room.localParticipant.identity) {
        syncAgentParticipant(participant);
      }
    });

    room.on(RoomEvent.ParticipantActive, (participant) => {
      if (participant.identity !== room.localParticipant.identity) {
        syncAgentParticipant(participant);
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === agentIdentityRef.current) {
        syncAgentParticipant(null);
      }
    });

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if (participant.identity !== room.localParticipant.identity) {
        syncAgentParticipant(participant);
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) {
        return;
      }

      const element = track.attach();
      element.autoplay = true;
      element.muted = !sessionActiveRef.current;
      element.dataset.participant = participant.identity;
      audioHostRef.current?.appendChild(element);
      if (sessionActiveRef.current) {
        void element.play().catch(() => undefined);
      }

      if (!agentIdentityRef.current && participant.identity !== room.localParticipant.identity) {
        syncAgentParticipant(participant);
      }
    });

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track, _publication: TrackPublication, participant) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }

        track.detach().forEach((element) => element.remove());

        const host = audioHostRef.current;
        if (!host) {
          return;
        }

        host
          .querySelectorAll(`[data-participant="${participant.identity}"]`)
          .forEach((element) => element.remove());
      },
    );

    room.registerTextStreamHandler(
      "lk.transcription",
      async (reader: any, participantInfo: any) => {
        const participantIdentity = participantInfo.identity as string;
        const isUserParticipant =
          room.localParticipant.identity === participantIdentity;
        const segmentId =
          (reader.info?.attributes?.["lk.segment_id"] as string | undefined) ??
          (reader.info?.id as string | undefined) ??
          crypto.randomUUID();
        const isFinalStream =
          String(reader.info?.attributes?.["lk.transcription_final"] ?? "false") === "true";

        let text = "";
        for await (const chunk of reader) {
          text += String(chunk);
          if (!sessionActiveRef.current && !isUserParticipant) {
            continue;
          }
          upsertTranscriptEntry(participantIdentity, segmentId, text, isFinalStream);
        }

        if (!sessionActiveRef.current && !isUserParticipant) {
          return;
        }
        upsertTranscriptEntry(participantIdentity, segmentId, text, isFinalStream);
      },
    );
  }

  async function prepareRoom() {
    if (roomRef.current && connectionState === "connected") {
      setIsPrepared(true);
      return;
    }

    const tokenResponse = await requestLiveKitToken();
    const room = new Room({
      adaptiveStream: true,
      audioCaptureDefaults: AUDIO_CAPTURE_OPTIONS,
      dynacast: true,
    });

    roomRef.current = room;
    registerRpcHandlers(room);
    attachRoomHandlers(room);

    await room.connect(
      process.env.NEXT_PUBLIC_LIVEKIT_URL ?? tokenResponse.wsUrl,
      tokenResponse.token,
    );

    await room.localParticipant.setAttributes({
      "session.state": "inactive",
    });

    setConnectionState("connected");
    setIsPrepared(true);
    setSessionActive(false);
    setIsMuted(true);
    setRemoteAudioEnabled(false);

    const firstAgent = findLikelyAgent(room);
    if (firstAgent) {
      syncAgentParticipant(firstAgent);
    } else {
      setAgentState("waiting");
    }
  }

  async function ensurePreparedRoom() {
    if (!preparePromiseRef.current) {
      preparePromiseRef.current = prepareRoom().catch((error) => {
        preparePromiseRef.current = null;
        throw error;
      });
    }

    try {
      await preparePromiseRef.current;
    } catch {
      setConnectionState("disconnected");
      setAgentState("disconnected");
      setIsPrepared(false);
    }
  }

  async function handleConnect() {
    setIsWorking(true);

    try {
      await ensurePreparedRoom();

      const room = roomRef.current;
      if (!room) {
        throw new Error("Room is not ready.");
      }

      transcriptCreatedAtRef.current = {};
      setTranscript([]);

      await room.startAudio();
      setRemoteAudioEnabled(true);
      await room.localParticipant.setAttributes({
        "session.state": "active",
      });
      await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE_OPTIONS);

      setIsMuted(false);
      setSessionActive(true);
      setAgentState(agentIdentityRef.current ? "connecting" : "waiting");
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePause() {
    setIsWorking(true);
    try {
      const room = roomRef.current;
      if (!room) {
        return;
      }

      await room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS);
      await room.localParticipant.setAttributes({
        "session.state": "inactive",
      });

      setRemoteAudioEnabled(false);
      setIsMuted(true);
      setSessionActive(false);
      setAgentState(agentIdentityRef.current ? "ready" : "waiting");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleEndSession() {
    setIsWorking(true);
    try {
      const room = roomRef.current;
      if (room) {
        try {
          await room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS);
        } catch {
          // Ignore mic shutdown errors during end-session cleanup.
        }

        try {
          await room.localParticipant.setAttributes({
            "session.state": "inactive",
          });
        } catch {
          // Ignore attribute update errors during disconnect.
        }
      }

      setRemoteAudioEnabled(false);
      await disconnectRoom();
    } finally {
      setIsWorking(false);
    }
  }

  async function handleToggleMute() {
    const room = roomRef.current;
    if (!room || !sessionActive) {
      return;
    }

    const nextMuted = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted, AUDIO_CAPTURE_OPTIONS);
    setIsMuted(nextMuted);
  }

  return (
    <div className="assistant-page">
      <VoiceCopilotPanel
        agentIdentity={agentIdentity}
        agentState={agentState}
        connectionState={connectionState}
        highlightedWidget={highlightedWidget}
        isMuted={isMuted}
        isPrepared={isPrepared}
        isWorking={isWorking}
        sessionActive={sessionActive}
        uiStage={getUiStage()}
        onConnect={handleConnect}
        onPause={handlePause}
        onEndSession={handleEndSession}
        onToggleMute={handleToggleMute}
        transcript={transcript}
      />

      <div ref={audioHostRef} className="audio-host" />
    </div>
  );
}
