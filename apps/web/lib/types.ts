export type TranscriptEntry = {
  id: string;
  role: "agent" | "user";
  speaker: string;
  text: string;
  isFinal: boolean;
  createdAt: number;
};

export type AssistantMode = "general" | "ask_docs" | "auto";

export type TokenResponse = {
  agentName: string;
  participantIdentity: string;
  roomName: string;
  token: string;
  wsUrl: string;
};

export type RagHealthResponse = {
  ok: boolean;
};

export type RagUploadResponse = {
  filenames: string[];
  documentIds: number[];
  message?: string;
};
