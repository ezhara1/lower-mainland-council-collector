export type MunicipalSource = {
  id: string;
  name: string;
  officialName: string;
  meetingPortalUrl: string;
  calendarUrl: string;
  platform: string;
  documentTypes: string[];
  accessNotes: string;
  enabledByDefault: boolean;
};

export type AppSettings = {
  outputFolder: string;
  openRouterModel: string;
};

export type CollectedDocument = {
  sourceId: string;
  municipality: string;
  title: string;
  url: string;
  meetingDate: string | null;
  publishedDate: string | null;
  mimeType: string;
  fileName: string;
  bytes: Buffer;
  text: string;
};

export type LibraryDocument = {
  id: string;
  sourceId: string;
  municipality: string;
  title: string;
  url: string;
  meetingDate: string | null;
  mimeType: string;
  filePath: string;
  collectedAt: string;
};

export type CollectRequest = {
  sourceIds: string[];
  dateFrom: string;
  dateTo: string;
  browserAssisted?: boolean;
};

export type ScriptRequest = {
  documentIds: string[];
  openRouterApiKey: string;
  openRouterModel?: string;
  outputMode: "summary" | "podcast" | "custom";
  customPrompt?: string;
  podcastStyle?: "analytical" | "conversational" | "witty" | "sensational" | "executive";
  podcastStyleNotes?: string;
  humorLevel?: "none" | "light" | "strong";
  allowProfanity?: boolean;
  energyLevel?: "calm" | "balanced" | "high";
  targetMinutes?: number;
  targetAudience?: string;
};

export type AudioRequest = {
  scriptName: string;
  ttsProvider: "kokoro" | "chatterbox";
  hostAVoice?: string;
  hostBVoice?: string;
  audioConcurrency?: number;
};

export type RunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  collected: number;
  skippedDuplicates: number;
  failedSources: { sourceId: string; error: string }[];
  files: { municipality: string; title: string; location: string }[];
  warnings: string[];
};
