export type Project = {
  id: number;
  projectKey: string;
  name: string;
  syncedAt: string;
};

export type IssueSummary = {
  issueKey: string;
  summary: string;
  updatedAt: string;
};

export type IssueDetail = {
  issueKey: string;
  summary: string;
  descriptionRaw: string;
  descriptionMd: string;
  updatedAt: string;
  syncedAt: string;
};

export type ExportHistory = {
  id: number;
  issueKey: string;
  exportPath: string;
  exportedAt: string;
};

export type SetupState = {
  spaceUrl?: string;
  hasApiKey: boolean;
  exportDir?: string;
};

export type AppError = {
  code: 'AUTH_INVALID' | 'FORBIDDEN' | 'NETWORK' | 'RATE_LIMIT' | 'KEYCHAIN' | 'NOT_FOUND' | 'UNKNOWN';
  message: string;
  recoverable: boolean;
};
