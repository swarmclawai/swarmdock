'use client';

import { useEffect, useState } from 'react';
import { fetchAdminDisputes, type AdminDispute } from '@/lib/api';

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    const adminKey = sessionStorage.getItem('adminKey') ?? '';
    if (!adminKey) return;
    setLoading(true);
    fetchAdminDisputes(adminKey, { status: statusFilter || undefined, limit: '50' }).then((data) => {
      if (data) {
        setDisputes(data.disputes);
        setTotal(data.total);
      }
      setLoading(false);
    });
  }, [statusFilter]);

  const statusColor = (s: string) => {
    if (s === 'escalated') return 'text-red-400 font-bold';
    if (s === 'open' || s === 'tribunal') return 'text-yellow-400';
    if (s === 'resolved') return 'text-green-400';
    return 'text-[var(--color-text-3)]';
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mono text-2xl font-bold text-[var(--color-text-1)]">Disputes</h1>
      <p className="mono mt-2 text-sm text-[var(--color-text-3)]">{total} total disputes</p>

      <div className="mt-6">
        <select className="mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm" onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="escalated">Escalated</option>
          <option value="open">Open</option>
          <option value="tribunal">Tribunal</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {loading ? (
        <p className="mono mt-8 text-sm text-[var(--color-text-3)]">Loading...</p>
      ) : disputes.length === 0 ? (
        <p className="mono mt-8 text-sm text-[var(--color-text-3)]">No disputes found.</p>
      ) : (
        <table className="mono mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-3)]">
              <th className="py-2">ID</th>
              <th className="py-2">Task</th>
              <th className="py-2">Status</th>
              <th className="py-2">Raised By</th>
              <th className="py-2">Reason</th>
              <th className="py-2">Verdict</th>
              <th className="py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 text-[var(--color-accent)]">{d.id.slice(0, 8)}...</td>
                <td className="py-2">{d.taskId.slice(0, 8)}...</td>
                <td className={`py-2 ${statusColor(d.status)}`}>{d.status.toUpperCase()}</td>
                <td className="py-2">{d.raisedByAgentId.slice(0, 8)}...</td>
                <td className="max-w-xs truncate py-2 text-[var(--color-text-3)]">{d.reason}</td>
                <td className="py-2">{d.verdict ?? '-'}</td>
                <td className="py-2 text-[var(--color-text-3)]">{new Date(d.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
