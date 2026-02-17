import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ask, open } from '@tauri-apps/api/dialog';
import {
  authReset,
  clearExports,
  exportsList,
  issueExportMarkdown,
  issueGetDetail,
  projectsSync,
  searchByKey,
  searchByKeyword,
  setExportDir,
  setupLoad,
  setupSave
} from './api';
import type { ExportHistory, IssueDetail, IssueSummary, Project } from './types';

const EXPORT_HISTORY_LIMIT = 200;

export function App() {
  const [spaceUrl, setSpaceUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [exportDir, setExportDirState] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<IssueDetail | null>(null);
  const [exports, setExports] = useState<ExportHistory[]>([]);

  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'key' | 'keyword'>('keyword');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const canSearch = isConfigured && query.trim().length > 0;

  function mapErrorMessage(raw: string) {
    let message = raw;
    if (raw.includes('[FORBIDDEN]')) {
      message = '権限不足です。Backlog 側のプロジェクト/課題閲覧権限を確認してください。';
    }
    if (raw.includes('[KEYCHAIN]')) {
      message =
        'APIキーをKeychainから取得できません。初期設定で再保存し、macOSのキーチェーンアクセス許可を確認してください。';
    }
    return message;
  }

  function handleAppError(err: unknown) {
    const raw = (err as Error).message;
    const message = mapErrorMessage(raw);
    if (raw.includes('[AUTH_INVALID]') || raw.includes('[KEYCHAIN]')) {
      setIsConfigured(false);
      setProjects([]);
      setIssues([]);
      setSelectedIssue(null);
    }
    setError(message);
  }

  useEffect(() => {
    void (async () => {
      try {
        const setup = await setupLoad();
        setSpaceUrl(setup.spaceUrl ?? '');
        setExportDirState(setup.exportDir ?? '');
        setIsConfigured(setup.hasApiKey && Boolean(setup.spaceUrl));
        if (setup.hasApiKey && setup.spaceUrl) {
          const history = await exportsList(EXPORT_HISTORY_LIMIT);
          setExports(history);
        }
      } catch (e) {
        handleAppError(e);
      }
    })();
  }, []);

  const selectedUpdated = useMemo(
    () => (selectedIssue ? new Date(selectedIssue.updatedAt).toLocaleString() : '-'),
    [selectedIssue]
  );

  async function handleSetupSave() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await setupSave(spaceUrl, apiKey);
      setApiKey('');
      setIsConfigured(true);
      const synced = await projectsSync();
      setProjects(synced);
      const history = await exportsList(EXPORT_HISTORY_LIMIT);
      setExports(history);
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncProjects() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const synced = await projectsSync();
      setProjects(synced);
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setIssues([]);
    setSelectedIssue(null);
    setHasSearched(false);
    try {
      const found = searchMode === 'key' ? await searchByKey(query) : await searchByKeyword(query);
      setIssues(found);
      setHasSearched(true);
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectIssue(issueKey: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const detail = await issueGetDetail(issueKey);
      setSelectedIssue(detail);
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!selectedIssue) return;
    setError(null);
    setNotice(null);
    setExportError(null);
    setExportNotice(null);
    if (!exportDir.trim()) {
      setExportError('先に保存先ディレクトリを設定してください。');
      return;
    }

    try {
      const path = await issueExportMarkdown(selectedIssue.issueKey, exportDir, false);
      setExportNotice(`エクスポートしました: ${path}`);
    } catch (e) {
      const raw = (e as Error).message;
      const message = mapErrorMessage(raw);
      if (raw.includes('[AUTH_INVALID]') || raw.includes('[KEYCHAIN]')) {
        setIsConfigured(false);
        setProjects([]);
        setIssues([]);
        setSelectedIssue(null);
      }
      setExportError(message);
      return;
    }

    const history = await exportsList(EXPORT_HISTORY_LIMIT);
    setExports(history);
  }

  async function handleAuthReset() {
    const yes = await ask('保存済みの認証情報（APIキー・Space URL）を削除します。続行しますか？', {
      title: '確認',
      type: 'warning'
    });
    if (!yes) return;

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await authReset();
      setApiKey('');
      setSpaceUrl('');
      setExportDirState('');
      setIsConfigured(false);
      setProjects([]);
      setIssues([]);
      setSelectedIssue(null);
      setExports([]);
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handlePickExportDir() {
    setError(null);
    setNotice(null);
    try {
      const result = await open({ directory: true, multiple: false });
      const picked = !result || Array.isArray(result) ? null : result;
      if (!picked) return;
      await setExportDir(picked);
      setExportDirState(picked);
      setNotice(`保存先を設定しました: ${picked}`);
    } catch (e) {
      handleAppError(e);
    }
  }

  async function handleClearExports() {
    const yes = await ask('エクスポート履歴をすべて削除します。続行しますか？', {
      title: '確認',
      type: 'warning'
    });
    if (!yes) return;

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await clearExports();
      setExports([]);
      setNotice('エクスポート履歴を削除しました。');
    } catch (e) {
      handleAppError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-root">
      <header className="app-header">
        <h1>Backlog Markdown Exporter</h1>
        <p>Backlog課題をMarkdownとしてローカル保存するmacOS向けツール</p>
      </header>

      {!isConfigured && (
        <section className="panel">
          <h2>初期設定</h2>
          <label>
            Space URL
            <input
              placeholder="https://xxx.backlog.com"
              value={spaceUrl}
              onChange={(e) => setSpaceUrl(e.target.value)}
            />
          </label>
          <label>
            APIキー
            <input
              placeholder="Backlog API Key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <button disabled={loading || !spaceUrl || !apiKey} onClick={handleSetupSave}>
            保存して接続テスト
          </button>
        </section>
      )}

      {isConfigured && (
        <>
          <section className="panel">
            <div className="row between">
              <h2>プロジェクト</h2>
              <div className="row gap">
                <button className="danger-button" onClick={handleAuthReset} disabled={loading}>
                  認証情報をリセット
                </button>
                <button onClick={handleSyncProjects} disabled={loading}>
                  同期
                </button>
              </div>
            </div>
            {projects.length === 0 ? (
              <p className="subtle">未同期です。同期ボタンで取得してください。</p>
            ) : (
              <ul className="project-list">
                {projects.map((p) => (
                  <li key={p.id}>
                    <strong>{p.projectKey}</strong> {p.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>課題検索</h2>
            <div className="row gap search-controls">
              <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as 'key' | 'keyword')}>
                <option value="keyword">キーワード</option>
                <option value="key">課題キー</option>
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSearch && !loading) {
                    void handleSearch();
                  }
                }}
                placeholder={searchMode === 'key' ? 'PROJ-123' : '検索キーワード'}
              />
              <button disabled={!canSearch || loading} onClick={handleSearch}>
                検索
              </button>
            </div>
            <ul className="issue-list">
              {issues.map((i) => (
                <li key={i.issueKey}>
                  <button className="issue-select-button" onClick={() => handleSelectIssue(i.issueKey)}>
                    <span>
                      <strong>{i.issueKey}</strong>: {i.summary}
                    </span>
                    <span className="issue-select-hint">クリックして詳細表示</span>
                  </button>
                </li>
              ))}
            </ul>
            {hasSearched && issues.length === 0 && <p className="subtle">検索結果が見つかりませんでした。</p>}
          </section>

          <section className="panel">
            <div className="row between">
              <h2>課題詳細</h2>
            </div>
            <div className="export-dir-row">
              <input readOnly value={exportDir} placeholder="保存先ディレクトリを選択してください" />
              <button onClick={handlePickExportDir} disabled={loading}>
                保存先を選択
              </button>
            </div>
            {!selectedIssue ? (
              <p className="subtle">課題を選択すると詳細を表示します。</p>
            ) : (
              <>
                <h3>
                  {selectedIssue.issueKey}: {selectedIssue.summary}
                </h3>
                <p className="subtle">更新日時: {selectedUpdated}</p>
                <article className="preview">
                  <ReactMarkdown>{selectedIssue.descriptionMd || '(本文なし)'}</ReactMarkdown>
                </article>
                <div className="row export-action-row">
                  <button disabled={!selectedIssue} onClick={handleExport}>
                    Markdownエクスポート
                  </button>
                </div>
                {exportNotice && <p className="status export-feedback">{exportNotice}</p>}
                {exportError && <p className="error export-feedback">{exportError}</p>}
              </>
            )}
          </section>

          <section className="panel">
            <div className="row between">
              <h2>エクスポート履歴</h2>
              <button className="danger-button" onClick={handleClearExports} disabled={loading || exports.length === 0}>
                履歴を消去
              </button>
            </div>
            {exports.length === 0 ? (
              <p className="subtle">履歴はありません。</p>
            ) : (
              <ul className="export-list export-history-container">
                {exports.map((x) => (
                  <li key={x.id} className="export-item">
                    <div>
                      <strong>{x.issueKey}</strong> - {x.exportPath}
                    </div>
                    <div className="subtle">{new Date(x.exportedAt).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {loading && <p className="status">処理中...</p>}
      {notice && <p className="status">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
