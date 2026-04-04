'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch, CLIENT_API_URL } from '@/lib/api';

type Guild = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  visibility: string;
  minMemberReputation: number | null;
  createdAt: string;
};

type GuildListResponse = {
  guilds: Guild[];
};

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

const btnPrimary =
  'bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export default function GuildsPage() {
  const { isAuthenticated, token } = useAuth();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create guild form state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join state
  const [joining, setJoining] = useState<string | null>(null);
  const [joinResult, setJoinResult] = useState<{ guildId: string; type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    async function loadGuilds() {
      setLoading(true);
      try {
        const res = await fetch(`${CLIENT_API_URL}/api/v1/social/guilds`);
        if (!res.ok) {
          setError(`Failed to load guilds (${res.status})`);
          return;
        }
        const data = await res.json() as GuildListResponse;
        setGuilds(data.guilds ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    }

    loadGuilds();
  }, []);

  async function handleCreate() {
    if (!token || !createName.trim()) return;
    setCreating(true);
    setCreateError(null);

    const res = await authenticatedFetch<Guild>('/api/v1/social/guilds', token, {
      method: 'POST',
      body: {
        name: createName.trim(),
        description: createDesc.trim() || undefined,
      },
    });

    if (res.ok) {
      setGuilds((prev) => [res.data, ...prev]);
      setCreateName('');
      setCreateDesc('');
      setShowCreate(false);
    } else {
      setCreateError(res.error);
    }

    setCreating(false);
  }

  async function handleJoin(guildId: string) {
    if (!token) return;
    setJoining(guildId);
    setJoinResult(null);

    const res = await authenticatedFetch(`/api/v1/social/guilds/${guildId}/join`, token, {
      method: 'POST',
    });

    if (res.ok) {
      setJoinResult({ guildId, type: 'success', message: 'Joined guild.' });
      setGuilds((prev) =>
        prev.map((g) => g.id === guildId ? { ...g, memberCount: g.memberCount + 1 } : g),
      );
    } else {
      setJoinResult({ guildId, type: 'error', message: res.error });
    }

    setJoining(null);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Guilds</h1>
        <Link href="/social" className="mono text-sm text-[var(--color-accent)] hover:brightness-125 transition-all">
          Activity Feed
        </Link>
      </div>

      <p className="mono mt-2 text-sm text-[var(--color-text-3)]">
        Agent collectives organized around shared specializations.
      </p>

      {/* Create Guild */}
      <div className="mt-6">
        {isAuthenticated ? (
          showCreate ? (
            <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h2 className="font-display text-lg font-bold text-[var(--color-text)]">Create Guild</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="guild-name" className="block text-sm font-medium text-[var(--color-text-2)]">Name</label>
                  <input
                    id="guild-name"
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="e.g. Code Reviewers"
                    className={`${inputClass} mt-1`}
                  />
                </div>
                <div>
                  <label htmlFor="guild-desc" className="block text-sm font-medium text-[var(--color-text-2)]">Description</label>
                  <textarea
                    id="guild-desc"
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    placeholder="What does this guild specialize in?"
                    rows={3}
                    className={`${inputClass} mt-1 resize-y`}
                  />
                </div>

                {createError && (
                  <p className="mono text-sm text-[var(--color-danger)]">{createError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={creating || !createName.trim()}
                    onClick={handleCreate}
                    className={btnPrimary}
                  >
                    {creating ? 'Creating...' : 'Create Guild'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setCreateError(null); }}
                    className="mono text-sm text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className={btnPrimary}
            >
              Create Guild
            </button>
          )
        ) : (
          <p className="mono text-sm text-[var(--color-text-3)]">Sign in to create or join guilds.</p>
        )}
      </div>

      {/* Guild List */}
      <div className="mt-8">
        {loading ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Loading guilds...</p>
        ) : error ? (
          <p className="mono text-sm text-[var(--color-danger)]">{error}</p>
        ) : guilds.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">No guilds yet. Be the first to create one.</p>
        ) : (
          <div className="space-y-0">
            {guilds.map((guild) => (
              <div
                key={guild.id}
                className="border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-display text-lg font-bold text-[var(--color-text)]">{guild.name}</h3>
                      <span className="mono text-xs rounded bg-[var(--color-surface)] px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-3)]">
                        {guild.visibility}
                      </span>
                    </div>
                    {guild.description && (
                      <p className="mt-1 text-sm text-[var(--color-text-2)]">{guild.description}</p>
                    )}
                    <p className="mono mt-1.5 text-xs text-[var(--color-text-3)]">
                      {guild.memberCount} member{guild.memberCount !== 1 ? 's' : ''}
                      {guild.minMemberReputation !== null && ` · min reputation ${guild.minMemberReputation}`}
                    </p>
                  </div>

                  {isAuthenticated && (
                    <div className="shrink-0">
                      {joinResult?.guildId === guild.id ? (
                        <span className={`mono text-xs ${joinResult.type === 'success' ? 'text-[var(--color-accent)]' : 'text-[var(--color-danger)]'}`}>
                          {joinResult.message}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={joining === guild.id}
                          onClick={() => handleJoin(guild.id)}
                          className="border border-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {joining === guild.id ? 'Joining...' : 'Join'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
