import { FormEvent, useEffect, useRef, useState } from 'react';
import { APP_NAME, type AuthSession, type IssueDetail, type IssueSummary, type Project } from '@baklogmd/shared';
import {
  completeBacklogOAuth,
  fetchIssueDetail,
  fetchProjects,
  loadAuthSession,
  logout,
  searchIssues,
  startBacklogOAuth
} from './api';
import { backlogToMarkdown } from './markdown';

const CALLBACK_PATH = '/auth/callback';

export function App() {
  const [spaceUrl, setSpaceUrl] = useState('');
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<IssueDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [searchMode, setSearchMode] = useState<'key' | 'keyword'>('keyword');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const callbackHandledRef = useRef(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const handled = await handleOAuthCallback();
      if (handled) return;

      const current = await loadAuthSession();
      setSession(current);
      if (current.authenticated) {
        await syncProjects();
      }
    } catch (e) {
      setError((e as Error).message);
      setSession({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuthCallback() {
    if (window.location.pathname !== CALLBACK_PATH) {
      return false;
    }
    if (callbackHandledRef.current) {
      return true;
    }
    callbackHandledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (oauthError) {
      setError(`Backlog認可エラー: ${oauthError}`);
      window.history.replaceState({}, document.title, '/');
      setSession({ authenticated: false });
      return true;
    }

    if (!code || !state) {
      setError('認可コールバックのパラメータが不正です。');
      window.history.replaceState({}, document.title, '/');
      setSession({ authenticated: false });
      return true;
    }

    const nextSession = await completeBacklogOAuth(code, state);
    setSession(nextSession);
    setNotice('Backlogアカウントでログインしました。');
    window.history.replaceState({}, document.title, '/');
    await syncProjects();
    return true;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      const authorizationUrl = await startBacklogOAuth(spaceUrl);
      window.location.assign(authorizationUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      await logout();
      setSession({ authenticated: false });
      setProjects([]);
      setIssues([]);
      setSelectedIssue(null);
      setNotice('ログアウトしました。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function syncProjects() {
    setSyncingProjects(true);
    try {
      const items = await fetchProjects();
      setProjects(items);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('Not authenticated')) {
        setSession({ authenticated: false });
      }
      setError(message);
    } finally {
      setSyncingProjects(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSearching(true);
    setIssues([]);
    setSelectedIssue(null);

    try {
      const found = await searchIssues(searchMode, query);
      setIssues(found);
      if (found.length === 0) {
        setNotice('課題が見つかりませんでした。');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectIssue(issueKey: string) {
    setLoadingDetail(true);
    setError(null);
    setDownloadNotice(null);
    try {
      const detail = await fetchIssueDetail(issueKey);
      setSelectedIssue(detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleDownloadMarkdown() {
    if (!selectedIssue) return;

    const title = `${selectedIssue.issueKey} ${selectedIssue.summary}`.trim();
    const convertedBody = backlogToMarkdown(selectedIssue.descriptionRaw || '');
    const markdown = [
      `# ${title}`,
      '',
      `- Issue Key: ${selectedIssue.issueKey}`,
      `- Updated At: ${selectedIssue.updatedAt}`,
      '',
      '---',
      '',
      convertedBody || '(説明なし)',
      ''
    ].join('\n');

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = `${selectedIssue.issueKey}-${selectedIssue.summary}`
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120);
    anchor.href = url;
    anchor.download = `${safeName || selectedIssue.issueKey}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setDownloadNotice('Markdownファイルをダウンロードしました。');
  }

  return (
    <main className="app-root">
      <header className="app-header">
        <h1>{APP_NAME} Web</h1>
        <p>Backlog課題をWeb上で検索・閲覧する社内向けツール</p>
      </header>

      {loading && <section className="panel">読み込み中...</section>}

      {!loading && !session.authenticated && (
        <section className="panel">
          <h2>ログイン</h2>
          <form onSubmit={handleLogin}>
            <label htmlFor="space-url">
              Space URL
              <input
                id="space-url"
                type="text"
                placeholder="https://your-space.backlog.com"
                value={spaceUrl}
                onChange={(e) => setSpaceUrl(e.target.value)}
                required
              />
            </label>
            <p className="subtle hint">`your-space.backlog.jp` のような入力でも `https://` を補完します。</p>
            <button type="submit" disabled={submitting}>
              {submitting ? '認証URLを取得中...' : 'Backlogでログイン'}
            </button>
          </form>
        </section>
      )}

      {!loading && session.authenticated && (
        <>
          <section className="panel">
            <div className="row between">
              <h2>セッション</h2>
              <button type="button" className="danger-button" onClick={handleLogout}>
                ログアウト
              </button>
            </div>
            <p>
              <strong>Space:</strong> {session.spaceUrl}
            </p>
            <p>
              <strong>User:</strong> {session.user?.name} ({session.user?.userId})
            </p>
          </section>

          <section className="panel">
            <div className="row between">
              <h2>プロジェクト</h2>
              <button type="button" onClick={() => void syncProjects()} disabled={syncingProjects}>
                {syncingProjects ? '同期中...' : '同期'}
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="subtle">プロジェクトが未取得です。</p>
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
            <form onSubmit={handleSearch} className="row gap search-controls">
              <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as 'key' | 'keyword')}>
                <option value="keyword">キーワード</option>
                <option value="key">課題キー</option>
              </select>
              <input
                type="text"
                placeholder={searchMode === 'key' ? 'PROJ-123' : '検索キーワード'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
              <button type="submit" disabled={searching}>
                {searching ? '検索中...' : '検索'}
              </button>
            </form>

            <ul className="issue-list">
              {issues.map((issue) => (
                <li key={issue.issueKey}>
                  <button className="issue-select-button" type="button" onClick={() => void handleSelectIssue(issue.issueKey)}>
                    <span>
                      <strong>{issue.issueKey}</strong>: {issue.summary}
                    </span>
                    <span className="issue-select-hint">クリックして詳細表示</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>課題詳細</h2>
            {loadingDetail && <p>詳細を取得中...</p>}
            {!loadingDetail && !selectedIssue && <p className="subtle">検索結果から課題を選択してください。</p>}
            {!loadingDetail && selectedIssue && (
              <article>
                <p>
                  <strong>{selectedIssue.issueKey}</strong>: {selectedIssue.summary}
                </p>
                <p className="subtle">更新日: {new Date(selectedIssue.updatedAt).toLocaleString()}</p>
                <div className="row gap">
                  <button type="button" onClick={handleDownloadMarkdown}>
                    Markdownをダウンロード
                  </button>
                </div>
                {downloadNotice && <p className="notice inline-notice">{downloadNotice}</p>}
                <pre className="preview">{selectedIssue.descriptionRaw || '(説明なし)'}</pre>
              </article>
            )}
          </section>
        </>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
