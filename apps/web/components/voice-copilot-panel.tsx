"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/types";

type VoiceCopilotPanelProps = {
  agentIdentity: string | null;
  agentState: string;
  connectionState: string;
  highlightedWidget: string | null;
  isMuted: boolean;
  isPrepared: boolean;
  isWorking: boolean;
  sessionActive: boolean;
  uiStage: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  transcript: TranscriptEntry[];
};

export function VoiceCopilotPanel({
  agentIdentity,
  agentState,
  connectionState,
  highlightedWidget,
  isMuted,
  isPrepared,
  isWorking,
  sessionActive,
  uiStage,
  onConnect,
  onDisconnect,
  onToggleMute,
  transcript,
}: VoiceCopilotPanelProps) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth",
    });
  }, [transcript]);

  const subtitle = !isPrepared
    ? "Preparing the voice session in the background..."
    : !sessionActive
      ? "Press Start Session when you're ready. The assistant will greet first."
      : uiStage === "Listening"
        ? "Go ahead, I'm listening."
        : uiStage === "Finalizing"
          ? "Finishing your question..."
          : uiStage === "Responding"
            ? "Responding..."
            : uiStage === "Speaking"
              ? "Speaking..."
              : "Session is starting...";

  return (
    <section className="assistant-shell">
      <div className="assistant-page-card">
        <div className="assistant-main">
          <header className="assistant-header">
            <div>
              <h1 className="assistant-title">Voice Assistant</h1>
              <p className="assistant-caption">
                General voice assistant with live transcript for both sides.
              </p>
            </div>
          </header>

          <div className="assistant-hero">
            <div
              className="highlightable"
              data-highlighted={highlightedWidget === "assistant-orb"}
            >
              <div className={`assistant-orb ${sessionActive ? "live" : ""}`} />
            </div>

            <div className="assistant-hero-copy">
              <h2 className="assistant-greeting">Hello, how can I help you?</h2>
              <p className="assistant-subtitle">{subtitle}</p>
            </div>
          </div>

          <div
            className="assistant-status-row highlightable"
            data-highlighted={highlightedWidget === "status-indicator"}
          >
            <span className="assistant-pill">Stage: {uiStage}</span>
            <span className="assistant-pill">Connection: {connectionState}</span>
            <span className="assistant-pill">Agent: {agentState}</span>
            <span className="assistant-pill">
              Participant: {agentIdentity ? "linked" : "waiting"}
            </span>
          </div>

          <div
            className="assistant-controls highlightable"
            data-highlighted={highlightedWidget === "voice-controls"}
          >
            <button
              className="assistant-button assistant-button-primary"
              onClick={onConnect}
              disabled={isWorking || !isPrepared || sessionActive}
            >
              Start Session
            </button>
            <button
              className="assistant-button"
              onClick={onToggleMute}
              disabled={!sessionActive || isWorking}
            >
              {isMuted ? "Unmute Mic" : "Mute Mic"}
            </button>
            <button
              className="assistant-button"
              onClick={onDisconnect}
              disabled={!sessionActive || isWorking}
            >
              End Session
            </button>
          </div>

          <div className="assistant-tool-hints">
            <div className="assistant-tool-hints-title">Try App-Aware Questions</div>
            <div className="assistant-tool-hints-list">
              <span className="assistant-tool-chip">What&apos;s on this page?</span>
              <span className="assistant-tool-chip">Summarize the mock data</span>
              <span className="assistant-tool-chip">Show me blocked items</span>
              <span className="assistant-tool-chip">Highlight the transcript area</span>
            </div>
          </div>
        </div>

        <aside className="assistant-transcript-panel">
          <div className="assistant-panel-header">
            <h2 className="assistant-panel-title">Live Transcript</h2>
            <span className="assistant-panel-note">You and AI speech appear here</span>
          </div>

          <div
            ref={transcriptRef}
            className="assistant-transcript highlightable"
            data-highlighted={highlightedWidget === "live-transcript"}
          >
            {transcript.length === 0 ? (
              <div className="assistant-empty">
                Start a session and speak. Your transcript and the AI transcript will show here live.
              </div>
            ) : (
              transcript.map((entry) => (
                <article
                  key={entry.id}
                  className="assistant-bubble"
                  data-role={entry.role}
                  data-final={entry.isFinal}
                >
                  <span className="assistant-bubble-label">{entry.speaker}</span>
                  <p className="assistant-bubble-text">{entry.text || "..."}</p>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
