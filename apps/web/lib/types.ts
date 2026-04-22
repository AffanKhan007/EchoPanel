export type SummaryValue = {
  id: string;
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down" | "steady";
};

export type DashboardItemStatus = "Live" | "Building" | "Blocked";

export type DashboardItem = {
  id: string;
  name: string;
  category: string;
  status: DashboardItemStatus;
  owner: string;
  region: string;
  score: number;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type AlertItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  timeAgo: string;
};

export type DrawerPanelName = "details" | "alerts" | "insights";

export type FilterState = {
  category: string;
  status: string;
  search: string;
};

export type TranscriptEntry = {
  id: string;
  role: "agent" | "user";
  speaker: string;
  text: string;
  isFinal: boolean;
  createdAt: number;
};

export type ActionEntry = {
  id: string;
  text: string;
  at: string;
  ok: boolean;
};

export type TokenResponse = {
  agentName: string;
  participantIdentity: string;
  roomName: string;
  token: string;
  wsUrl: string;
};

export type PageContextPayload = {
  route: string;
  pageTitle: string;
  visibleWidgets: string[];
  activeFilters: FilterState;
  selectedEntity: string | null;
};

