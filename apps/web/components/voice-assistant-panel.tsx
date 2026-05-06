"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssistantMode, TranscriptEntry } from "@/lib/types";

type VoiceAssistantPanelProps = {
  agentIdentity: string | null;
  agentState: string;
  assistantMode: AssistantMode;
  connectionState: string;
  documentServiceError: string | null;
  documentServiceReady: boolean;
  documentUploadMessage: string | null;
  isMuted: boolean;
  isPrepared: boolean;
  isUploadingDocuments: boolean;
  isWorking: boolean;
  sessionActive: boolean;
  uiStage: string;
  uploadedDocuments: string[];
  onAssistantModeChange: (mode: AssistantMode) => void;
  onConnect: () => void;
  onPause: () => void;
  onEndSession: () => void;
  onToggleMute: () => void;
  onSubmitTextQuestion: (question: string) => Promise<void>;
  onUploadDocuments: (files: FileList | null) => Promise<void>;
  isSubmittingText: boolean;
  transcript: TranscriptEntry[];
};

export function VoiceAssistantPanel({
  agentIdentity,
  agentState,
  assistantMode,
  connectionState,
  documentServiceError,
  documentServiceReady,
  documentUploadMessage,
  isMuted,
  isPrepared,
  isUploadingDocuments,
  isWorking,
  sessionActive,
  uiStage,
  uploadedDocuments,
  onAssistantModeChange,
  onConnect,
  onPause,
  onEndSession,
  onToggleMute,
  onSubmitTextQuestion,
  onUploadDocuments,
  isSubmittingText,
  transcript,
}: VoiceAssistantPanelProps) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const autoScrollResetTimerRef = useRef<number | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const modeLabel =
    assistantMode === "ask_docs" ? "Ask Docs" : assistantMode === "auto" ? "Auto" : "General";
  const modeDescription =
    assistantMode === "ask_docs"
      ? "Ground answers in the files you upload."
      : assistantMode === "auto"
        ? "Smartly routes between docs, weather, and general answers."
        : "Direct, low-latency general voice assistant.";
  const sessionBadge = sessionActive ? (isMuted ? "Live · mic muted" : "Live · recording") : "Standby";
  const transcriptStatus = sessionActive ? (isMuted ? "Monitoring" : "Streaming") : "Idle";
  const documentStateLabel = isUploadingDocuments
    ? "Indexing"
    : documentServiceReady
      ? "Ready"
      : "Checking";
  const systemStatusCards = [
    {
      label: "Agent",
      value: agentIdentity ? "Connected" : "Waiting",
      tone: agentIdentity ? "positive" : "neutral",
    },
    {
      label: "LiveKit",
      value: connectionState === "connected" ? "Ready" : connectionState,
      tone: connectionState === "connected" ? "positive" : "neutral",
    },
    {
      label: "RAG Backend",
      value:
        assistantMode === "general"
          ? "Optional"
          : documentServiceReady
            ? "Ready"
            : documentServiceError
              ? "Needs attention"
              : "Checking",
      tone:
        assistantMode === "general"
          ? "neutral"
          : documentServiceReady
            ? "positive"
            : documentServiceError
              ? "warning"
              : "neutral",
    },
    {
      label: "Transcript",
      value: sessionActive ? "Active" : "Idle",
      tone: sessionActive ? "positive" : "neutral",
    },
  ] as const;

  function formatTimestamp(createdAt: number) {
    return new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(createdAt));
  }

  useEffect(() => {
    return () => {
      if (autoScrollResetTimerRef.current !== null) {
        window.clearTimeout(autoScrollResetTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const node = transcriptRef.current;
    const endNode = transcriptEndRef.current;
    if (!node || !endNode) {
      return;
    }

    if (!autoScrollRef.current) {
      setShowJumpToLatest(true);
      return;
    }

    isProgrammaticScrollRef.current = true;
    setShowJumpToLatest(false);

    const frame = window.requestAnimationFrame(() => {
      endNode.scrollIntoView({
        block: "end",
        behavior: transcript.length > 1 ? "smooth" : "auto",
      });

      if (autoScrollResetTimerRef.current !== null) {
        window.clearTimeout(autoScrollResetTimerRef.current);
      }

      autoScrollResetTimerRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 260);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [transcript]);

  const subtitle = !isPrepared
    ? "Preparing the voice session in the background..."
    : !sessionActive
      ? assistantMode === "ask_docs"
        ? "Press Start Session when you're ready. Ask Docs mode will use your uploaded documents."
        : assistantMode === "auto"
          ? "Press Start Session when you're ready. Auto mode will choose between general and document-grounded answers."
        : "Press Start Session when you're ready. You can then speak or type a question."
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
              <span className="assistant-eyebrow">Realtime Copilot</span>
              <h1 className="assistant-title">Voice Assistant</h1>
              <p className="assistant-caption">
                A conversational workspace for voice, documents, and quick routed answers.
              </p>
            </div>
            <div className="assistant-header-badges">
              <span className="assistant-metric-card">
                <span className="assistant-metric-label">Mode</span>
                <strong>{modeLabel}</strong>
              </span>
              <span className="assistant-metric-card">
                <span className="assistant-metric-label">Session</span>
                <strong>{sessionBadge}</strong>
              </span>
            </div>
          </header>

          <div className="assistant-dashboard-grid">
            <div className="assistant-left-column">
              <div className="assistant-hero">
                <div className="highlightable assistant-orb-shell">
                  <div className={`assistant-orb ${sessionActive ? "live" : ""}`} />
                  <div className={`assistant-orb-ring ${sessionActive ? "live" : ""}`} />
                  <div className="assistant-orb-grid" />
                </div>

                <div className="assistant-hero-copy">
                  <h2 className="assistant-greeting">Hello, how can I help you?</h2>
                  <p className="assistant-subtitle">{subtitle}</p>
                  <div className="assistant-hero-meta">
                    <span className={`assistant-live-indicator ${sessionActive ? "is-live" : ""}`}>
                      <span className="assistant-live-dot" />
                      {sessionBadge}
                    </span>
                    <span className="assistant-hero-hint">{modeDescription}</span>
                  </div>
                </div>
              </div>

              <div className="assistant-status-row highlightable">
                <span className="assistant-pill">Stage: {uiStage}</span>
                <span className="assistant-pill">Connection: {connectionState}</span>
                <span className="assistant-pill">Agent: {agentState}</span>
                <span className="assistant-pill">Mode: {modeLabel}</span>
                <span className="assistant-pill">Participant: {agentIdentity ? "linked" : "waiting"}</span>
              </div>

              <section className="assistant-mode-section highlightable">
                <div className="assistant-section-heading">
                  <div>
                    <p className="assistant-section-label">Modes</p>
                    <h3 className="assistant-section-title">Choose your interaction style</h3>
                  </div>
                  <span className="assistant-section-note">Visible above the fold for faster switching.</span>
                </div>
                <div className="assistant-mode-switch" role="tablist" aria-label="Assistant mode">
                  <button
                    className={`assistant-mode-button ${assistantMode === "general" ? "is-active" : ""}`}
                    onClick={() => onAssistantModeChange("general")}
                    disabled={isWorking || isUploadingDocuments}
                    type="button"
                  >
                    <span className="assistant-mode-title">General</span>
                    <span className="assistant-mode-copy">Fast direct answers</span>
                  </button>
                  <button
                    className={`assistant-mode-button ${assistantMode === "auto" ? "is-active" : ""}`}
                    onClick={() => onAssistantModeChange("auto")}
                    disabled={isWorking || isUploadingDocuments}
                    type="button"
                  >
                    <span className="assistant-mode-title">Auto</span>
                    <span className="assistant-mode-copy">Docs, weather, or general</span>
                  </button>
                  <button
                    className={`assistant-mode-button ${assistantMode === "ask_docs" ? "is-active" : ""}`}
                    onClick={() => onAssistantModeChange("ask_docs")}
                    disabled={isWorking || isUploadingDocuments}
                    type="button"
                  >
                    <span className="assistant-mode-title">Ask Docs</span>
                    <span className="assistant-mode-copy">Strictly grounded responses</span>
                  </button>
                </div>
              </section>
            </div>

            <div className="assistant-center-column">
              <section className="assistant-controls-card highlightable">
                <div className="assistant-section-heading">
                  <div>
                    <p className="assistant-section-label">Session Controls</p>
                    <h3 className="assistant-section-title">Run the assistant without scrolling</h3>
                  </div>
                  <span className={`assistant-recording-indicator ${sessionActive ? "is-live" : ""}`}>
                    <span className="assistant-recording-dot" />
                    {sessionActive ? (isMuted ? "Mic muted" : "Mic live") : "Ready"}
                  </span>
                </div>

                <div className="assistant-controls">
                  <button
                    className="assistant-button assistant-button-primary"
                    onClick={onConnect}
                    disabled={isWorking || sessionActive}
                  >
                    <span>{sessionActive ? "Session Live" : "Start Session"}</span>
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
              </section>

              {assistantMode !== "general" ? (
                <section className="assistant-docs-panel highlightable">
                  <div className="assistant-docs-header">
                    <div>
                      <p className="assistant-section-label">Knowledge Upload</p>
                      <h3 className="assistant-docs-title">Document Mode</h3>
                      <p className="assistant-docs-copy">
                        {assistantMode === "ask_docs"
                          ? "Upload files here, then ask grounded questions against them."
                          : "Upload files here so Auto mode can route document questions into your RAG backend."}
                      </p>
                    </div>
                    <span className={`assistant-service-badge ${documentServiceReady ? "is-ready" : "is-checking"}`}>
                      <span className="assistant-service-dot" />
                      {documentStateLabel}
                    </span>
                  </div>

                  <div className={`assistant-upload-surface ${isUploadingDocuments ? "is-loading" : ""}`}>
                    <input
                      id="assistant-docs-input"
                      className="assistant-docs-input"
                      type="file"
                      accept=".pdf,.txt,.docx"
                      multiple
                      onChange={async (event) => {
                        await onUploadDocuments(event.target.files);
                        event.target.value = "";
                      }}
                      disabled={isUploadingDocuments}
                    />
                    <label
                      className={`assistant-upload-label ${isUploadingDocuments ? "is-disabled" : ""}`}
                      htmlFor="assistant-docs-input"
                      aria-disabled={isUploadingDocuments}
                    >
                      <span className="assistant-upload-icon">{isUploadingDocuments ? "..." : "↑"}</span>
                      <span>
                        <strong>{isUploadingDocuments ? "Uploading & indexing" : "Upload documents"}</strong>
                        <small>
                          {isUploadingDocuments
                            ? "Preparing your knowledge source..."
                            : "PDF, TXT, or DOCX. Upload first, then ask grounded questions."}
                        </small>
                      </span>
                    </label>
                    {isUploadingDocuments ? <div className="assistant-upload-progress" aria-hidden="true" /> : null}
                  </div>

                  {documentUploadMessage ? (
                    <p className="assistant-docs-feedback">{documentUploadMessage}</p>
                  ) : null}

                  {documentServiceError ? (
                    <p className="assistant-docs-error">{documentServiceError}</p>
                  ) : null}

                  {uploadedDocuments.length > 0 ? (
                    <div className="assistant-docs-list">
                      {uploadedDocuments.map((name) => (
                        <article key={name} className="assistant-doc-card">
                          <span className="assistant-doc-card-icon">DOC</span>
                          <div className="assistant-doc-card-copy">
                            <strong>{name}</strong>
                            <small>Indexed and ready for grounded answers</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="assistant-docs-empty">
                      No documents uploaded in this session yet.
                    </p>
                  )}
                </section>
              ) : null}

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
                <div className="assistant-section-heading">
                  <div>
                    <label className="assistant-text-label" htmlFor="assistant-text-question">
                      {assistantMode === "ask_docs"
                        ? "Type a document question"
                        : assistantMode === "auto"
                          ? "Type a question for Auto mode"
                          : "Type a question"}
                    </label>
                    <p className="assistant-text-note">
                      {assistantMode === "ask_docs"
                        ? "Ask Docs mode sends the question to your RAG backend and uses the returned answer as the spoken reply."
                        : assistantMode === "auto"
                          ? "Auto mode uses a small router prompt to choose between the general assistant and your RAG backend."
                          : "Typed questions are usually faster because they skip speech-to-text."}
                    </p>
                  </div>
                  <span className="assistant-input-hint">
                    {assistantMode === "general" ? "Fastest path" : "Grounded flow"}
                  </span>
                </div>
                <div className="assistant-text-row">
                  <input
                    id="assistant-text-question"
                    className="assistant-text-input"
                    type="text"
                    placeholder={
                      assistantMode === "ask_docs"
                        ? "Ask something about your uploaded documents"
                        : assistantMode === "auto"
                          ? "Ask anything and Auto mode will choose the route"
                        : "Type your question here"
                    }
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
                    {isSubmittingText ? (
                      <span className="assistant-button-inline">
                        <span className="assistant-spinner" />
                        Sending
                      </span>
                    ) : (
                      "Send"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <aside className="assistant-transcript-panel">
          <div className="assistant-panel-header">
            <div>
              <span className="assistant-section-label">Conversation</span>
              <h2 className="assistant-panel-title">Live Transcript</h2>
              <span className="assistant-panel-note">You and AI speech appear here in real time</span>
            </div>
            <span className={`assistant-transcript-status ${sessionActive ? "is-live" : ""}`}>
              <span className="assistant-transcript-status-dot" />
              {transcriptStatus}
            </span>
          </div>

          <div className="assistant-transcript-wrap">
            <div
              ref={transcriptRef}
              className="assistant-transcript highlightable"
              onScroll={(event) => {
                if (isProgrammaticScrollRef.current) {
                  return;
                }

                const node = event.currentTarget;
                const distanceFromBottom =
                  node.scrollHeight - node.scrollTop - node.clientHeight;
                const nearBottom = distanceFromBottom < 48;
                autoScrollRef.current = nearBottom;
                setShowJumpToLatest(!nearBottom);
              }}
            >
            {transcript.length === 0 ? (
              <div className="assistant-empty">
                <div className="assistant-empty-icon">...</div>
                <p className="assistant-empty-title">Transcript will appear here</p>
                <p className="assistant-empty-copy">
                  Start a session, speak, or type a question. Your messages and the assistant replies
                  will stream here live.
                </p>
              </div>
            ) : (
              transcript.map((entry) => (
                <article
                  key={entry.id}
                  className="assistant-bubble"
                  data-role={entry.role}
                  data-final={entry.isFinal}
                >
                  <div className="assistant-bubble-meta">
                    <span className="assistant-bubble-label">
                      {entry.speaker}
                      {!entry.isFinal ? <span className="assistant-bubble-pending">live</span> : null}
                    </span>
                    <span className="assistant-bubble-time">{formatTimestamp(entry.createdAt)}</span>
                  </div>
                  <p className="assistant-bubble-text">{entry.text || "..."}</p>
                </article>
              ))
            )}
            <div ref={transcriptEndRef} aria-hidden="true" />
            </div>
            {showJumpToLatest ? (
              <button
                className="assistant-jump-button"
                type="button"
                onClick={() => {
                  const node = transcriptRef.current;
                  if (!node) {
                    return;
                  }

                  autoScrollRef.current = true;
                  isProgrammaticScrollRef.current = true;
                  setShowJumpToLatest(false);
                  transcriptEndRef.current?.scrollIntoView({
                    block: "end",
                    behavior: "smooth",
                  });
                  if (autoScrollResetTimerRef.current !== null) {
                    window.clearTimeout(autoScrollResetTimerRef.current);
                  }
                  autoScrollResetTimerRef.current = window.setTimeout(() => {
                    isProgrammaticScrollRef.current = false;
                  }, 260);
                }}
              >
                Jump to latest
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="assistant-secondary-sections">
        <section className="assistant-info-card">
          <div className="assistant-section-heading">
            <div>
              <p className="assistant-section-label">Flow Overview</p>
              <h3 className="assistant-section-title">How EchoPanel Works</h3>
            </div>
          </div>
          <div className="assistant-flow-grid">
            <article className="assistant-flow-step">
              <span className="assistant-flow-index">1</span>
              <strong>Voice or typed input</strong>
              <p>Start a session, speak naturally, or type when you need the fastest possible response.</p>
            </article>
            <article className="assistant-flow-step">
              <span className="assistant-flow-index">2</span>
              <strong>AI reasoning</strong>
              <p>LiveKit streams the turn into the agent and the session chooses the best path.</p>
            </article>
            <article className="assistant-flow-step">
              <span className="assistant-flow-index">3</span>
              <strong>RAG or weather when needed</strong>
              <p>Auto mode can route to documents or the weather service when the question needs it.</p>
            </article>
            <article className="assistant-flow-step">
              <span className="assistant-flow-index">4</span>
              <strong>Spoken answer + transcript</strong>
              <p>The reply comes back in audio while the transcript keeps the full conversation visible.</p>
            </article>
          </div>
        </section>

        <section className="assistant-info-card">
          <div className="assistant-section-heading">
            <div>
              <p className="assistant-section-label">What It Can Do</p>
              <h3 className="assistant-section-title">Capabilities</h3>
            </div>
          </div>
          <div className="assistant-capabilities-grid">
            <article className="assistant-capability-card">
              <strong>Voice conversation</strong>
              <p>Realtime microphone input, spoken replies, and quick session controls for demos and testing.</p>
            </article>
            <article className="assistant-capability-card">
              <strong>Document Q&amp;A</strong>
              <p>Upload TXT, PDF, or DOCX files and use Ask Docs for grounded answers based on the indexed content.</p>
            </article>
            <article className="assistant-capability-card">
              <strong>Weather & tool routing</strong>
              <p>Auto mode can decide when a question belongs to general chat, document lookup, or weather retrieval.</p>
            </article>
            <article className="assistant-capability-card">
              <strong>Live transcript</strong>
              <p>Readable message bubbles, assistant/user separation, and scrollable transcript history on the right.</p>
            </article>
            <article className="assistant-capability-card">
              <strong>Low-latency assistant</strong>
              <p>Designed for quick turn-taking, interruption handling, and a cleaner operator experience on desktop.</p>
            </article>
          </div>
        </section>

        <section className="assistant-info-card">
          <div className="assistant-section-heading">
            <div>
              <p className="assistant-section-label">System Snapshot</p>
              <h3 className="assistant-section-title">System Status</h3>
            </div>
          </div>
          <div className="assistant-status-cards">
            {systemStatusCards.map((card) => (
              <article key={card.label} className={`assistant-status-card assistant-status-card-${card.tone}`}>
                <span className="assistant-status-card-label">{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="assistant-info-card">
          <div className="assistant-section-heading">
            <div>
              <p className="assistant-section-label">Best Practices</p>
              <h3 className="assistant-section-title">Tips for Best Results</h3>
            </div>
          </div>
          <div className="assistant-tips-grid">
            <article className="assistant-tip-card">
              <strong>Speak clearly</strong>
              <p>Let the greeting finish, then ask the question directly for the cleanest transcript and fastest turn detection.</p>
            </article>
            <article className="assistant-tip-card">
              <strong>Use Ask Docs for uploaded files</strong>
              <p>Upload first, then ask grounded questions that explicitly reference the content you want searched.</p>
            </article>
            <article className="assistant-tip-card">
              <strong>Use General mode for open questions</strong>
              <p>For jokes, coding explanations, or broad chat, General keeps the path simple and responsive.</p>
            </article>
            <article className="assistant-tip-card">
              <strong>Upload cleaner source files</strong>
              <p>Well-structured TXT, DOCX, or PDF files produce better indexing and more reliable document answers.</p>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}
