import { FormEvent, useEffect, useRef, useState } from 'react';
import { APP_NAME, type AuthSession } from '@baklogmd/shared';
import { completeBacklogOAuth, loadAuthSession, logout, startBacklogOAuth } from './api';

const CALLBACK_PATH = '/auth/callback';

export function App() {
  const [spaceUrl, setSpaceUrl] = useState('');
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setNotice('ログアウトしました。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <section className="card">
        <h1>{APP_NAME} Web</h1>
        <p className="subtle">Backlog OAuth認証のWebクライアント</p>

        {loading && <p>読み込み中...</p>}

        {!loading && !session.authenticated && (
          <form onSubmit={handleLogin} className="form">
            <label htmlFor="space-url">Backlog Space URL</label>
            <input
              id="space-url"
              type="text"
              placeholder="https://your-space.backlog.com"
              value={spaceUrl}
              onChange={(e) => setSpaceUrl(e.target.value)}
              required
            />
            <p className="hint">`your-space.backlog.jp` のような入力でも自動で `https://` を補完します。</p>
            <button type="submit" disabled={submitting}>
              {submitting ? '認証URLを取得中...' : 'Backlogでログイン'}
            </button>
          </form>
        )}

        {!loading && session.authenticated && (
          <div className="session-box">
            <p>
              <strong>Space:</strong> {session.spaceUrl}
            </p>
            <p>
              <strong>User:</strong> {session.user?.name} ({session.user?.userId})
            </p>
            <p>
              <strong>Token Exp:</strong>{' '}
              {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : 'unknown'}
            </p>
            <button type="button" className="ghost" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        )}

        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
