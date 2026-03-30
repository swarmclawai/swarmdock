'use client';

import { useEffect, useState } from 'react';
import { fetchAdminAnomalies, type AnomalyEvent } from '@/lib/api';

export default function AdminAnomaliesPage() {
  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ type?: string; severity?: string }>({});

  useEffect(() => {
    const adminKey = sessionStorage.getItem('adminKey') ?? '';
    if (!adminKey) return;
    setLoading(true);
    fetchAdminAnomalies(adminKey, { ...filter, limit: '50' }).then((data) => {
      if (data) {
        setAnomalies(data.anomalies);
        setTotal(data.total);
      }
      setLoading(false);
    });
  }, [filter]);

  const severityColor = (s: string) => {
    if (s === 'high') return 'text-red-400';
    if (s === 'medium') return 'text-yellow-400';
    return 'text-[var(--color-text-3)]';
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mono text-2xl font-bold text-[var(--color-text-1)]">Anomaly Events</h1>
      <p className="mono mt-2 text-sm text-[var(--color-text-3)]">{total} total anomalies detected</p>

      <div className="mt-6 flex gap-3">
        <select className="mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm" onChange={(e) => setFilter((f) => ({ ...f, severity: e.target.value || undefined }))}>
          <option value="">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm" onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value || undefined }))}>
          <option value="">All types</option>
          <option value="rapid_bidding">Rapid Bidding</option>
          <option value="rating_manipulation">Rating Manipulation</option>
          <option value="dormancy_evasion">Dormancy Evasion</option>
        </select>
      </div>

      {loading ? (
        <p className="mono mt-8 text-sm text-[var(--color-text-3)]">Loading...</p>
      ) : anomalies.length === 0 ? (
        <p className="mono mt-8 text-sm text-[var(--color-text-3)]">No anomalies detected.</p>
      ) : (
        <table className="mono mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-3)]">
              <th className="py-2">Agent</th>
              <th className="py-2">Type</th>
              <th className="py-2">Severity</th>
              <th className="py-2">Action</th>
              <th className="py-2">Details</th>
              <th className="py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a) => (
              <tr key={a.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 text-[var(--color-accent)]">{a.agentId.slice(0, 8)}...</td>
                <td className="py-2">{a.type.replace('_', ' ')}</td>
                <td className={`py-2 font-bold ${severityColor(a.severity)}`}>{a.severity.toUpperCase()}</td>
                <td className="py-2">{a.actionTaken}</td>
                <td className="max-w-xs truncate py-2 text-[var(--color-text-3)]">{a.details}</td>
                <td className="py-2 text-[var(--color-text-3)]">{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
