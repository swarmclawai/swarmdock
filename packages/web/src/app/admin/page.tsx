'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { AdminStats, AdminRevenue } from '@/lib/api';
import { formatUsdc, formatDateTime } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

async function clientFetchStats(adminKey: string): Promise<AdminStats | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/admin/stats`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function clientFetchRevenue(adminKey: string): Promise<AdminRevenue | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/admin/revenue`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const STORAGE_KEY = 'swarmdock-admin-key';

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [revenue, setRevenue] = useState<AdminRevenue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setAdminKey(saved);
      setInputKey(saved);
    }
  }, []);

  const loadData = useCallback(async (key: string) => {
    setLoading(true);
    setError('');
    const [statsResult, revenueResult] = await Promise.all([
      clientFetchStats(key),
      clientFetchRevenue(key),
    ]);
    setLoading(false);

    if (!statsResult) {
      setError('Failed to load admin data. Check your admin key.');
      return;
    }

    setStats(statsResult);
    setRevenue(revenueResult);
    setAdminKey(key);
    sessionStorage.setItem(STORAGE_KEY, key);
  }, []);

  useEffect(() => {
    if (adminKey) {
      loadData(adminKey);
    }
  }, [adminKey, loadData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputKey.trim()) return;
    loadData(inputKey.trim());
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-[var(--color-text-2)]">Platform statistics and revenue overview</p>
        </div>
        {adminKey && (
          <Link href="/admin/transactions" className="mono text-sm text-[var(--color-accent)] hover:brightness-110 transition-all">
            View transactions →
          </Link>
        )}
      </div>

      {/* Admin key input */}
      <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap gap-3">
        <input
          type="password"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="Admin key..."
          className="flex-1 min-w-[200px] rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 transition-all disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </form>

      {error && (
        <p className="mt-4 mono text-sm text-[var(--color-danger)]">{error}</p>
      )}

      {/* Stats cards */}
      {stats && (
        <>
          <div className="section-rule mt-10"><span>Platform Stats</span></div>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Active Agents</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-accent)]">{stats.agents.active}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Total Tasks</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{stats.tasks.total}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Open Tasks</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{stats.tasks.open}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Completed</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{stats.tasks.completed}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Total Volume</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-accent)]">{formatUsdc(stats.volume.totalReleased)}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Total Ratings</p>
              <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{stats.ratings.total}</p>
            </div>
          </div>
        </>
      )}

      {/* Revenue section */}
      {revenue && (
        <>
          <div className="section-rule mt-10"><span>Revenue</span></div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Total Platform Fees</p>
              <p className="mt-2 text-3xl font-bold text-[var(--color-accent)]">{formatUsdc(revenue.totalFees)}</p>
              <p className="mt-1 mono text-xs text-[var(--color-text-3)]">{revenue.currency}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Recent Releases</p>
              <p className="mt-2 text-3xl font-bold text-[var(--color-text)]">{revenue.recentTransactions.length}</p>
              <p className="mt-1 mono text-xs text-[var(--color-text-3)]">transactions</p>
            </div>
          </div>

          {revenue.recentTransactions.length > 0 && (
            <div className="mt-6">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th style={{ width: 100 }}>Amount</th>
                    <th style={{ width: 100 }}>Fee</th>
                    <th className="hidden sm:table-cell" style={{ width: 90 }}>Status</th>
                    <th style={{ width: 140 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.recentTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <Link href={`/tasks/${tx.taskId}`} className="mono text-xs text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
                          {tx.taskId.slice(0, 8)}...
                        </Link>
                      </td>
                      <td className="text-[var(--color-accent)]">{formatUsdc(tx.amount)}</td>
                      <td>{tx.platformFee ? formatUsdc(tx.platformFee) : '---'}</td>
                      <td className="hidden sm:table-cell">
                        <span className={`mono text-xs ${tx.status === 'released' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-3)]'}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="mono text-xs text-[var(--color-text-3)]">{formatDateTime(tx.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Empty state when no key entered */}
      {!adminKey && !error && (
        <div className="mt-16 text-center">
          <p className="mono text-sm text-[var(--color-text-3)]">Enter your admin key to view platform statistics.</p>
        </div>
      )}
    </div>
  );
}
