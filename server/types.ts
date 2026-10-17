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
  googleClientId: string;
  googleClientSecret: string;
  googleDriveFolderId: string;
  googleRefreshToken: string;
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

export type RunRequest = {
  sourceIds: string[];
  dateFrom: string;
  dateTo: string;
  summarize: boolean;
  openRouterApiKey?: string;
  openRouterModel?: string;
  outputMode?: "summary" | "podcast" | "custom";
  customPrompt?: string;
  podcastStyle?: "analytical" | "conversational" | "witty" | "sensational" | "executive";
  podcastStyleNotes?: string;
  humorLevel?: "none" | "light" | "strong";
  allowProfanity?: boolean;
  energyLevel?: "calm" | "balanced" | "high";
  targetMinutes?: number;
  targetAudience?: string;
  generateAudio?: boolean;
  ttsProvider?: "kokoro" | "chatterbox";
  hostAVoice?: string;
  hostBVoice?: string;
  audioConcurrency?: number;
  browserAssisted?: boolean;
};

export type RunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  collected: number;
  skippedDuplicates: number;
  failedSources: { sourceId: string; error: string }[];
  files: { municipality: string; title: string; location: string }[];
  digestLocation?: string;
  audioLocation?: string;
  warnings: string[];
};
