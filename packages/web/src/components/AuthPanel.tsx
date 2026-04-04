'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

type Tab = 'token' | 'key';

export function AuthButton() {
  const { isAuthenticated, agentId, displayName, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="mono text-xs text-[var(--color-accent)]" title={agentId ?? ''}>
          {displayName ?? agentId?.slice(0, 8)}
        </span>
        <button
          onClick={logout}
          className="mono text-xs text-[var(--color-text-3)] hover:text-[var(--color-danger)] transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
      >
        Sign In
      </button>
      {open && <AuthModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const { loginWithToken, loginWithKey } = useAuth();
  const [tab, setTab] = useState<Tab>('token');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!value.trim()) {
      setError(tab === 'token' ? 'Token is required' : 'Private key is required');
      return;
    }

    if (tab === 'token') {
      const ok = loginWithToken(value);
      if (!ok) {
        setError('Invalid or expired token');
        return;
      }
      onClose();
    } else {
      setLoading(true);
      try {
        await loginWithKey(value);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-bg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--color-text)]">Agent Sign In</h2>
          <button onClick={onClose} className="text-[var(--color-text-3)] hover:text-[var(--color-text)] text-lg">&times;</button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex border-b border-[var(--color-border)]">
          <button
            className={`px-4 py-2 text-sm transition-colors ${
              tab === 'token'
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
            }`}
            onClick={() => { setTab('token'); setValue(''); setError(null); }}
          >
            Paste Token
          </button>
          <button
            className={`px-4 py-2 text-sm transition-colors ${
              tab === 'key'
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
            }`}
            onClick={() => { setTab('key'); setValue(''); setError(null); }}
          >
            Ed25519 Key
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4">
          {tab === 'token' ? (
            <div>
              <label htmlFor="auth-token" className="block text-sm text-[var(--color-text-2)]">
                Agent Authentication Token (AAT)
              </label>
              <textarea
                id="auth-token"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="eyJhbGciOi..."
                rows={3}
                className={`${inputClass} mt-1 font-mono text-xs`}
              />
              <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                JWT issued during agent registration or login.
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="auth-key" className="block text-sm text-[var(--color-text-2)]">
                Ed25519 Private Key (base64)
              </label>
              <textarea
                id="auth-key"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Base64-encoded Ed25519 secret key..."
                rows={3}
                className={`${inputClass} mt-1 font-mono text-xs`}
              />
              <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                Full challenge-response authentication. Key is stored in localStorage.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
