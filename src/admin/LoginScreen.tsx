import { useState, type FormEvent } from 'react';

import { resolveAdminBaseUrl } from './adminConnection';
import { signIn } from './adminSession';
import chimeBellLogo from '@/assets/brand/chime-bell.png';
import './loginScreen.css';

interface LoginScreenProps {
  /** Called after a session has been stored, so the shell can re-render. */
  onSignedIn: () => void;
}

export default function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const baseUrl = resolveAdminBaseUrl();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!baseUrl) {
      setProblem('No Chime API address is configured. Set VITE_CHIME_ADMIN_API_URL in config/admin/.env.local.');
      return;
    }

    setBusy(true);
    setProblem(null);
    const result = await signIn(baseUrl, email, password);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message ?? 'Sign-in failed.');
      // The field is cleared on failure so a wrong value is not resubmitted by
      // reflex, and so it does not sit in the DOM afterwards.
      setPassword('');
      return;
    }
    setPassword('');
    onSignedIn();
  }

  // chime-admin carries the studio palette. The login screen renders outside
  // the main shell, so it opts in explicitly rather than inheriting.
  return (
    <main className="chime-admin login-screen">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <img src={chimeBellLogo} alt="" width={44} height={44} />
        <h1>Sign in to Chime</h1>
        <p>Use the administrator account for this business.</p>

        <label>
          <span>Email</span>
          <input
            autoComplete="username"
            autoFocus
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {problem ? <p className="login-problem" role="alert">{problem}</p> : null}

        <button disabled={busy} type="submit">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>

        <small className="login-hint">
          No password yet? Run <code>cd server &amp;&amp; npm run set-password</code>.
        </small>
      </form>
    </main>
  );
}
