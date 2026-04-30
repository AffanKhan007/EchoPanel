export type TranscriptEntry = {
  id: string;
  role: "agent" | "user";
  speaker: string;
  text: string;
  isFinal: boolean;
  createdAt: number;
};

export type TokenResponse = {
  agentName: string;
  participantIdentity: string;
  roomName: string;
  token: string;
  wsUrl: string;
};
