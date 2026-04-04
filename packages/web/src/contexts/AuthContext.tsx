'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64 } = tweetnaclUtil;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

interface AuthState {
  token: string | null;
  agentId: string | null;
  displayName: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  /** Sign in by pasting an existing AAT JWT */
  loginWithToken: (token: string) => boolean;
  /** Sign in with Ed25519 private key (challenge-response) */
  loginWithKey: (privateKeyBase64: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'swarmdock_auth';

function loadStoredAuth(): AuthState {
  if (typeof window === 'undefined') return { token: null, agentId: null, displayName: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, agentId: null, displayName: null };
    const parsed = JSON.parse(raw) as AuthState;
    // Check expiry
    if (parsed.token) {
      const payload = decodeJwtPayload(parsed.token);
      if (payload?.exp && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return { token: null, agentId: null, displayName: null };
      }
    }
    return parsed;
  } catch {
    return { token: null, agentId: null, displayName: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ token: null, agentId: null, displayName: null });

  // Load from localStorage on mount
  useEffect(() => {
    setAuth(loadStoredAuth());
  }, []);

  const persistAuth = useCallback((state: AuthState) => {
    setAuth(state);
    if (state.token) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const loginWithToken = useCallback((token: string): boolean => {
    const payload = decodeJwtPayload(token.trim());
    if (!payload) return false;

    const agentId = (payload.agent_id as string) ?? null;
    const exp = payload.exp as number | undefined;

    if (!agentId) return false;
    if (exp && exp * 1000 < Date.now()) return false;

    persistAuth({
      token: token.trim(),
      agentId,
      displayName: (payload.display_name as string) ?? agentId.slice(0, 8),
    });
    return true;
  }, [persistAuth]);

  const loginWithKey = useCallback(async (privateKeyBase64: string) => {
    const secretKey = decodeBase64(privateKeyBase64.trim());
    const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
    const publicKeyBase64 = encodeBase64(keyPair.publicKey);

    // Step 1: Get challenge
    const challengeRes = await fetch(`${API_URL}/api/v1/agents/login/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: publicKeyBase64 }),
    });

    if (!challengeRes.ok) {
      const err = await challengeRes.json().catch(() => null);
      throw new Error(err?.error ?? `Challenge failed (${challengeRes.status})`);
    }

    const { challenge } = await challengeRes.json() as { challenge: string };

    // Step 2: Sign challenge
    const messageBytes = new TextEncoder().encode(challenge);
    const signature = nacl.sign.detached(messageBytes, secretKey);
    const signatureBase64 = encodeBase64(signature);

    // Step 3: Verify
    const verifyRes = await fetch(`${API_URL}/api/v1/agents/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKeyBase64,
        challenge,
        signature: signatureBase64,
      }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => null);
      throw new Error(err?.error ?? `Verification failed (${verifyRes.status})`);
    }

    const result = await verifyRes.json() as {
      token: string;
      agent: { id: string; displayName: string };
    };

    persistAuth({
      token: result.token,
      agentId: result.agent.id,
      displayName: result.agent.displayName,
    });
  }, [persistAuth]);

  const logout = useCallback(() => {
    persistAuth({ token: null, agentId: null, displayName: null });
  }, [persistAuth]);

  return (
    <AuthContext.Provider
      value={{
        ...auth,
        isAuthenticated: !!auth.token,
        loginWithToken,
        loginWithKey,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
