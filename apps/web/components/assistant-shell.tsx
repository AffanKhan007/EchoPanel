"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
} from "livekit-client";
import { requestLiveKitToken } from "@/lib/livekit";
import { requestRagHealth, uploadRagDocuments } from "@/lib/rag";
import type { AssistantMode, TranscriptEntry } from "@/lib/types";
import { VoiceAssistantPanel } from "@/components/voice-assistant-panel";

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

export function AssistantShell() {
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("general");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [connectionState, setConnectionState] = useState("disconnected");
  const [agentState, setAgentState] = useState("waiting");
  const [agentIdentity, setAgentIdentity] = useState<string | null>(null);
  const [documentServiceReady, setDocumentServiceReady] = useState(false);
  const [documentServiceError, setDocumentServiceError] = useState<string | null>(null);
  const [documentUploadMessage, setDocumentUploadMessage] = useState<string | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<string[]>([]);
  const [uploadedDocumentIds, setUploadedDocumentIds] = useState<number[]>([]);
  const [isMuted, setIsMuted] = useState(true);
  const [isPrepared, setIsPrepared] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isSubmittingText, setIsSubmittingText] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const agentIdentityRef = useRef<string | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);
  const prepareStartedRef = useRef(false);
  const transcriptCreatedAtRef = useRef<Record<string, number>>({});
  const sessionActiveRef = useRef(false);
  const syncedAssistantModeRef = useRef<AssistantMode | null>(null);

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    if (prepareStartedRef.current) {
      return;
    }

    prepareStartedRef.current = true;
    void ensurePreparedRoom();
  }, []);

  useEffect(() => {
    if (assistantMode === "general") {
      setDocumentServiceError(null);
      return;
    }

    let cancelled = false;

    void requestRagHealth()
      .then(() => {
        if (cancelled) {
          return;
        }
        setDocumentServiceReady(true);
        setDocumentServiceError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDocumentServiceReady(false);
        setDocumentServiceError(
          error instanceof Error ? error.message : "Unable to reach the document service.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [assistantMode]);

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

  async function syncAssistantMode(mode: AssistantMode, force = false) {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    if (!force && syncedAssistantModeRef.current === mode) {
      return;
    }

    try {
      await room.localParticipant.setAttributes({
        "assistant.mode": mode,
      });
      syncedAssistantModeRef.current = mode;
    } catch {
      // Ignore mode sync issues when the room is reconnecting or closing.
    }
  }

  async function syncUploadedDocumentIds(documentIds: number[]) {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    try {
      await room.localParticipant.setAttributes({
        "assistant.document_ids": JSON.stringify(documentIds),
      });
    } catch {
      // Ignore sync issues when the room is reconnecting or closing.
    }
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

  function appendTranscriptEntry(
    role: TranscriptEntry["role"],
    speaker: string,
    text: string,
  ) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    setTranscript((current) =>
      [...current, { id, role, speaker, text, isFinal: true, createdAt }]
        .filter((entry) => entry.text.trim().length > 0)
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-30),
    );
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
    setTranscript([]);
    syncedAssistantModeRef.current = null;
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
    attachRoomHandlers(room);

    await room.connect(
      process.env.NEXT_PUBLIC_LIVEKIT_URL ?? tokenResponse.wsUrl,
      tokenResponse.token,
    );

    await room.localParticipant.setAttributes({
      "assistant.mode": assistantMode,
      "assistant.document_ids": JSON.stringify(uploadedDocumentIds),
      "session.state": "inactive",
    });
    syncedAssistantModeRef.current = assistantMode;

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
      await syncAssistantMode(assistantMode);
      await syncUploadedDocumentIds(uploadedDocumentIds);
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

  async function handleSubmitTextQuestion(question: string) {
    const room = roomRef.current;
    if (!room || !sessionActive) {
      return;
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    setIsSubmittingText(true);

    try {
      await room.startAudio();
      setRemoteAudioEnabled(true);
      await syncAssistantMode(assistantMode);
      await syncUploadedDocumentIds(uploadedDocumentIds);
      await room.localParticipant.sendText(trimmedQuestion, {
        topic: "lk.chat",
      });
      appendTranscriptEntry("user", "You", trimmedQuestion);
    } finally {
      setIsSubmittingText(false);
    }
  }

  async function handleAssistantModeChange(mode: AssistantMode) {
    setAssistantMode(mode);
    setDocumentUploadMessage(null);
    await syncAssistantMode(mode);
  }

  async function handleUploadDocuments(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setIsUploadingDocuments(true);
    setDocumentUploadMessage(null);

    try {
      const response = await uploadRagDocuments(Array.from(files));
      if (response.documentIds.length === 0) {
        setDocumentServiceReady(false);
        setDocumentServiceError(
          "Upload succeeded, but EchoPanel did not receive document IDs from the document service.",
        );
        setDocumentUploadMessage(null);
        return;
      }

      setUploadedDocuments((current) => {
        const next = new Set([...current, ...response.filenames]);
        return Array.from(next);
      });
      setUploadedDocumentIds(response.documentIds);
      await syncUploadedDocumentIds(response.documentIds);
      setDocumentServiceReady(true);
      setDocumentServiceError(null);
      setDocumentUploadMessage(
        response.message ?? `Uploaded ${response.filenames.join(", ")} successfully.`,
      );
    } catch (error) {
      setDocumentServiceReady(false);
      setDocumentServiceError(
        error instanceof Error ? error.message : "Unable to upload documents.",
      );
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  return (
    <div className="assistant-page">
      <VoiceAssistantPanel
        agentIdentity={agentIdentity}
        agentState={agentState}
        assistantMode={assistantMode}
        connectionState={connectionState}
        documentServiceError={documentServiceError}
        documentServiceReady={documentServiceReady}
        documentUploadMessage={documentUploadMessage}
        isMuted={isMuted}
        isPrepared={isPrepared}
        isUploadingDocuments={isUploadingDocuments}
        isWorking={isWorking}
        sessionActive={sessionActive}
        uiStage={getUiStage()}
        uploadedDocuments={uploadedDocuments}
        onAssistantModeChange={handleAssistantModeChange}
        onConnect={handleConnect}
        onPause={handlePause}
        onEndSession={handleEndSession}
        onToggleMute={handleToggleMute}
        onSubmitTextQuestion={handleSubmitTextQuestion}
        onUploadDocuments={handleUploadDocuments}
        isSubmittingText={isSubmittingText}
        transcript={transcript}
      />

      <div ref={audioHostRef} className="audio-host" />
    </div>
  );
}
