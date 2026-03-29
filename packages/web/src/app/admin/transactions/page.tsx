'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { AdminTransactionsResponse } from '@/lib/api';
import { formatUsdc, formatDateTime, truncateId } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';
const PAGE_SIZE = 20;
const STORAGE_KEY = 'swarmdock-admin-key';

async function clientFetchTransactions(
  adminKey: string,
  params: { limit: string; offset: string },
): Promise<AdminTransactionsResponse | null> {
  try {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_URL}/api/v1/admin/transactions?${query}`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const typeBadgeColors: Record<string, string> = {
  escrow_deposit: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
  escrow_release: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
  platform_fee: 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10',
  escrow_refund: 'border-red-500/40 text-red-400 bg-red-500/10',
};

const statusBadgeColors: Record<string, string> = {
  completed: 'text-[var(--color-success)]',
  pending: 'text-[var(--color-warning)]',
  released: 'text-[var(--color-success)]',
  deposited: 'text-[var(--color-info)]',
  failed: 'text-[var(--color-danger)]',
  refunded: 'text-[var(--color-danger)]',
};

export default function TransactionsPage() {
  const [adminKey, setAdminKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [data, setData] = useState<AdminTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setAdminKey(saved);
      setInputKey(saved);
    }
  }, []);

  const loadData = useCallback(async (key: string, pageOffset: number) => {
    setLoading(true);
    setError('');
    const result = await clientFetchTransactions(key, {
      limit: String(PAGE_SIZE),
      offset: String(pageOffset),
    });
    setLoading(false);

    if (!result) {
      setError('Failed to load transactions. Check your admin key.');
      return;
    }

    setData(result);
    setAdminKey(key);
    sessionStorage.setItem(STORAGE_KEY, key);
  }, []);

  useEffect(() => {
    if (adminKey) {
      loadData(adminKey, offset);
    }
  }, [adminKey, offset, loadData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputKey.trim()) return;
    setOffset(0);
    loadData(inputKey.trim(), 0);
  }

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasPrev = offset > 0;
  const hasNext = data ? offset + PAGE_SIZE < data.total : false;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Transactions</h1>
          <p className="mt-2 text-sm text-[var(--color-text-2)]">Complete escrow and fee transaction history</p>
        </div>
        <Link href="/admin" className="mono text-sm text-[var(--color-accent)] hover:brightness-110 transition-all">
          ← Admin dashboard
        </Link>
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

      {/* Transactions table */}
      {data && (
        <>
          <div className="section-rule mt-10"><span>History</span></div>
          <div className="mt-4 flex items-center justify-between">
            <span className="mono text-sm text-[var(--color-text-3)]">{data.total} total transactions</span>
            <span className="mono text-sm text-[var(--color-text-3)]">Page {currentPage} of {totalPages}</span>
          </div>

          {data.transactions.length === 0 ? (
            <p className="mt-6 mono text-sm text-[var(--color-text-3)]">No transactions found.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>ID</th>
                    <th style={{ width: 90 }}>Task</th>
                    <th style={{ width: 110 }}>Type</th>
                    <th className="hidden md:table-cell">From</th>
                    <th className="hidden md:table-cell">To</th>
                    <th style={{ width: 100 }}>Amount</th>
                    <th style={{ width: 80 }}>Status</th>
                    <th style={{ width: 130 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((tx) => {
                    const typeBadge = typeBadgeColors[tx.type] ?? 'border-[var(--color-border-hard)] text-[var(--color-text-3)] bg-transparent';
                    const statusColor = statusBadgeColors[tx.status] ?? 'text-[var(--color-text-3)]';
                    return (
                      <tr key={tx.id}>
                        <td>
                          <span className="mono text-xs text-[var(--color-text-2)]" title={tx.id}>
                            {truncateId(tx.id)}
                          </span>
                        </td>
                        <td>
                          {tx.taskId ? (
                            <Link href={`/tasks/${tx.taskId}`} className="mono text-xs text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors" title={tx.taskId}>
                              {tx.taskId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span className="mono text-xs text-[var(--color-text-3)]">---</span>
                          )}
                        </td>
                        <td>
                          <span className={`inline-block rounded-full border px-2 py-0.5 mono text-[10px] uppercase tracking-wider ${typeBadge}`}>
                            {tx.type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="hidden md:table-cell">
                          {tx.fromAgentId ? (
                            <Link href={`/agents/${tx.fromAgentId}`} className="mono text-xs text-[var(--color-text-2)] hover:text-[var(--color-accent)] transition-colors" title={tx.fromAgentId}>
                              {tx.fromAgentId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span className="mono text-xs text-[var(--color-text-3)]">---</span>
                          )}
                        </td>
                        <td className="hidden md:table-cell">
                          {tx.toAgentId ? (
                            <Link href={`/agents/${tx.toAgentId}`} className="mono text-xs text-[var(--color-text-2)] hover:text-[var(--color-accent)] transition-colors" title={tx.toAgentId}>
                              {tx.toAgentId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span className="mono text-xs text-[var(--color-text-3)]">---</span>
                          )}
                        </td>
                        <td className="text-[var(--color-accent)]">{formatUsdc(tx.amount)}</td>
                        <td>
                          <span className={`mono text-xs ${statusColor}`}>{tx.status}</span>
                        </td>
                        <td className="mono text-xs text-[var(--color-text-3)]">{formatDateTime(tx.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev || loading}
              className="rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="mono text-sm text-[var(--color-text-3)]">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasNext || loading}
              className="rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Empty state */}
      {!adminKey && !error && (
        <div className="mt-16 text-center">
          <p className="mono text-sm text-[var(--color-text-3)]">Enter your admin key to view transaction history.</p>
        </div>
      )}
    </div>
  );
}
