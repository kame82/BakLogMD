import { invoke } from '@tauri-apps/api/tauri';
import type { ExportHistory, IssueDetail, IssueSummary, Project, SetupState } from './types';

function normalizeError(e: unknown): Error {
  if (typeof e === 'string') {
    try {
      const parsed = JSON.parse(e) as { code?: string; message?: string };
      return new Error(parsed.message ? `[${parsed.code ?? 'UNKNOWN'}] ${parsed.message}` : e);
    } catch {
      return new Error(e);
    }
  }
  if (e instanceof Error) return e;
  return new Error('Unknown error');
}

export async function setupLoad(): Promise<SetupState> {
  try {
    return await invoke<SetupState>('setup_load');
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function setupSave(spaceUrl: string, apiKey: string): Promise<void> {
  try {
    await invoke('setup_save', { spaceUrl, apiKey });
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function projectsSync(): Promise<Project[]> {
  try {
    return await invoke<Project[]>('projects_sync');
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function searchByKey(issueKey: string): Promise<IssueSummary[]> {
  try {
    return await invoke<IssueSummary[]>('issues_search_by_key', { issueKey });
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function searchByKeyword(keyword: string): Promise<IssueSummary[]> {
  try {
    return await invoke<IssueSummary[]>('issues_search_by_keyword', { keyword });
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function issueGetDetail(issueKey: string): Promise<IssueDetail> {
  try {
    return await invoke<IssueDetail>('issue_get_detail', { issueKey });
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function issueExportMarkdown(issueKey: string, targetDir: string, overwrite: boolean): Promise<string> {
  try {
    const result = await invoke<{ path: string }>('issue_export_markdown', {
      issueKey,
      targetDir,
      overwrite
    });
    return result.path;
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function exportsList(limit = 20): Promise<ExportHistory[]> {
  try {
    return await invoke<ExportHistory[]>('exports_list', { limit });
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function clearExports(): Promise<void> {
  try {
    await invoke('exports_clear');
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function authReset(): Promise<void> {
  try {
    await invoke('auth_reset');
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function setExportDir(exportDir: string): Promise<void> {
  try {
    await invoke('set_export_dir', { exportDir });
  } catch (e) {
    throw normalizeError(e);
  }
}
