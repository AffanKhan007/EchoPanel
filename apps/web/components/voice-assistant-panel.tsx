"use client";

import { useEffect, useRef } from "react";
import { useState } from "react";
import type { TranscriptEntry } from "@/lib/types";

type VoiceAssistantPanelProps = {
  agentIdentity: string | null;
  agentState: string;
  connectionState: string;
  isMuted: boolean;
  isPrepared: boolean;
  isWorking: boolean;
  sessionActive: boolean;
  uiStage: string;
  onConnect: () => void;
  onPause: () => void;
  onEndSession: () => void;
  onToggleMute: () => void;
  onSubmitTextQuestion: (question: string) => Promise<void>;
  isSubmittingText: boolean;
  transcript: TranscriptEntry[];
};

export function VoiceAssistantPanel({
  agentIdentity,
  agentState,
  connectionState,
  isMuted,
  isPrepared,
  isWorking,
  sessionActive,
  uiStage,
  onConnect,
  onPause,
  onEndSession,
  onToggleMute,
  onSubmitTextQuestion,
  isSubmittingText,
  transcript,
}: VoiceAssistantPanelProps) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");

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
      ? "Press Start Session when you're ready. You can then speak or type a question."
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
            <div className="highlightable">
              <div className={`assistant-orb ${sessionActive ? "live" : ""}`} />
            </div>

            <div className="assistant-hero-copy">
              <h2 className="assistant-greeting">Hello, how can I help you?</h2>
              <p className="assistant-subtitle">{subtitle}</p>
            </div>
          </div>

          <div className="assistant-status-row highlightable">
            <span className="assistant-pill">Stage: {uiStage}</span>
            <span className="assistant-pill">Connection: {connectionState}</span>
            <span className="assistant-pill">Agent: {agentState}</span>
            <span className="assistant-pill">
              Participant: {agentIdentity ? "linked" : "waiting"}
            </span>
          </div>

          <div className="assistant-controls highlightable">
            <button
              className="assistant-button assistant-button-primary"
              onClick={onConnect}
              disabled={isWorking || sessionActive}
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
              onClick={onPause}
              disabled={!sessionActive || isWorking}
            >
              Pause Session
            </button>
            <button
              className="assistant-button assistant-button-danger"
              onClick={onEndSession}
              disabled={isWorking || (!sessionActive && connectionState !== "connected")}
            >
              End Session
            </button>
          </div>

          <form
            className="assistant-text-form highlightable"
            onSubmit={async (event) => {
              event.preventDefault();
              const nextQuestion = draftQuestion.trim();
              if (!nextQuestion) {
                return;
              }

              await onSubmitTextQuestion(nextQuestion);
              setDraftQuestion("");
            }}
          >
            <label className="assistant-text-label" htmlFor="assistant-text-question">
              Type a question
            </label>
            <div className="assistant-text-row">
              <input
                id="assistant-text-question"
                className="assistant-text-input"
                type="text"
                placeholder="Type your question here"
                value={draftQuestion}
                onChange={(event) => setDraftQuestion(event.target.value)}
                disabled={!sessionActive || isWorking || isSubmittingText}
              />
              <button
                className="assistant-button assistant-button-primary"
                type="submit"
                disabled={
                  !sessionActive ||
                  isWorking ||
                  isSubmittingText ||
                  draftQuestion.trim().length === 0
                }
              >
                {isSubmittingText ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </div>

        <aside className="assistant-transcript-panel">
          <div className="assistant-panel-header">
            <h2 className="assistant-panel-title">Live Transcript</h2>
            <span className="assistant-panel-note">You and AI speech appear here</span>
          </div>

          <div
            ref={transcriptRef}
            className="assistant-transcript highlightable"
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
