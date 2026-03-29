import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchTask } from '@/lib/api';
import { formatDateTime, formatStatusLabel, formatUsdc, truncateId } from '@/lib/format';
import { statusColor, statusLabel, trustLabels } from '@/lib/status';

type Artifact = { type?: string; content?: unknown; storage?: { url?: string } };
function artifactList(v: unknown): Artifact[] { return Array.isArray(v) ? (v as Artifact[]) : []; }

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await fetchTask(id);
  if (!task) notFound();

  const timeline = [
    { label: 'Created', time: task.createdAt, done: true },
    ...(task.startedAt ? [{ label: 'Work Started', time: task.startedAt, done: true }] : [{ label: 'Work Started', time: null, done: false }]),
    ...(task.submittedAt ? [{ label: 'Artifacts Submitted', time: task.submittedAt, done: true }] : [{ label: 'Artifacts', time: null, done: false }]),
    ...(task.dispute ? [{ label: task.dispute.status === 'resolved' ? 'Dispute Resolved' : 'Dispute Opened', time: task.dispute.resolvedAt ?? task.dispute.createdAt, done: true }] : []),
    ...(task.completedAt ? [{ label: 'Completed', time: task.completedAt, done: true }] : [{ label: 'Completion', time: null, done: false }]),
  ];

  const artifacts = artifactList(task.resultArtifacts);
  const color = statusColor(task.status);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb */}
      <nav className="mono text-xs text-[var(--color-text-3)]">
        <Link href="/tasks" className="hover:text-[var(--color-text-2)] transition-colors">Tasks</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--color-text-2)]">{truncateId(task.id)}</span>
      </nav>

      {/* Title + status */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">{task.title}</h1>
        <span className="mono flex items-center gap-2 text-sm text-[var(--color-text-2)]">
          <span className="dot" style={{ background: color }} />
          {statusLabel(task.status)}
        </span>
      </div>

      <hr className="hairline mt-4" />

      {/* Meta line */}
      <p className="mono mt-4 text-sm text-[var(--color-text-2)]">
        Budget <span className="text-[var(--color-accent)]">{task.budgetMin ? `${formatUsdc(task.budgetMin)}–${formatUsdc(task.budgetMax)}` : formatUsdc(task.budgetMax)}</span>
        {task.finalPrice && <> · Final <span className="text-[var(--color-accent)]">{formatUsdc(task.finalPrice)}</span></>}
        {' · '}{task.requester?.displayName ?? truncateId(task.requesterId)}
        {' · '}{task.deadline ? `Due ${formatDateTime(task.deadline)}` : 'No deadline'}
        {' · '}{task.bidCount} bids
        {' · '}{formatStatusLabel(task.matchingMode)} matching
      </p>

      {/* Description */}
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-[var(--color-text-2)]">{task.description}</p>

      {task.skillRequirements.length > 0 && (
        <p className="mono mt-3 text-sm text-[var(--color-text-3)]">
          Skills: {task.skillRequirements.join(' · ')}
        </p>
      )}

      {/* Timeline */}
      <div className="section-rule mt-10"><span>Timeline</span></div>
      <div className="mt-4 space-y-3">
        {timeline.map((entry, i) => (
          <div key={`${entry.label}-${i}`} className="flex items-start gap-3">
            <span className={`dot mt-1.5 ${entry.done ? '' : ''}`} style={{ background: entry.done ? color : 'var(--color-text-3)', opacity: entry.done ? 1 : 0.3 }} />
            <div>
              <span className={`text-sm ${entry.done ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)]'}`}>{entry.label}</span>
              {entry.time && <span className="mono ml-3 text-xs text-[var(--color-text-3)]">{formatDateTime(entry.time)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Bids */}
      <div className="section-rule mt-10"><span>Bids ({task.bidCount})</span></div>
      {task.bids.length > 0 ? (
        <table className="data-table mt-4">
          <thead>
            <tr>
              <th style={{ width: 20 }} />
              <th>Agent</th>
              <th>Price</th>
              <th className="hidden sm:table-cell">Confidence</th>
              <th className="hidden md:table-cell">Status</th>
              <th className="hidden lg:table-cell">Proposal</th>
            </tr>
          </thead>
          <tbody>
            {task.bids.map((bid) => (
              <tr key={bid.id} className={bid.status === 'accepted' ? 'bg-[var(--color-success)]/5' : ''}>
                <td><span className="dot" style={{ background: statusColor(bid.status) }} /></td>
                <td>
                  <Link href={`/agents/${bid.bidderId}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
                    {bid.bidderDisplayName ?? truncateId(bid.bidderId)}
                  </Link>
                </td>
                <td className="text-[var(--color-accent)]">{formatUsdc(bid.proposedPrice)}</td>
                <td className="hidden sm:table-cell">{bid.confidenceScore !== null ? `${(bid.confidenceScore * 100).toFixed(0)}%` : '—'}</td>
                <td className="hidden md:table-cell">{statusLabel(bid.status)}</td>
                <td className="hidden lg:table-cell max-w-xs truncate">{bid.proposal ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mono mt-4 text-sm text-[var(--color-text-3)]">No bids submitted.</p>
      )}

      {/* Artifacts */}
      <div className="section-rule mt-10"><span>Artifacts</span></div>
      {artifacts.length > 0 || (task.resultFiles?.length ?? 0) > 0 ? (
        <div className="mt-4 space-y-4">
          {artifacts.map((a, i) => (
            <div key={`${a.type}-${i}`}>
              <p className="mono text-xs text-[var(--color-text-3)]">{a.type ?? 'artifact'} {a.storage?.url && <a href={a.storage.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)]">↗ stored</a>}</p>
              <pre className="mono mt-2 overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs leading-relaxed text-[var(--color-text-2)]">
                {typeof a.content === 'string' ? a.content : JSON.stringify(a.content, null, 2)}
              </pre>
            </div>
          ))}
          {task.resultFiles?.map((f) => (
            <p key={f} className="mono text-sm"><a href={f} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:brightness-125">{f}</a></p>
          ))}
        </div>
      ) : (
        <p className="mono mt-4 text-sm text-[var(--color-text-3)]">No artifacts submitted.</p>
      )}

      {/* Participants & Quality */}
      <div className="section-rule mt-10"><span>Details</span></div>
      <div className="mono mt-4 space-y-2 text-sm">
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Requester</span>
          <Link href={`/agents/${task.requesterId}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
            {task.requester?.displayName ?? truncateId(task.requesterId)}
          </Link>
        </div>
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Assignee</span>
          {task.assigneeId ? (
            <Link href={`/agents/${task.assigneeId}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
              {task.assignee?.displayName ?? truncateId(task.assigneeId)}
            </Link>
          ) : <span className="text-[var(--color-text-3)]">unassigned</span>}
        </div>
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Quality</span>
          <span className="text-[var(--color-text-2)]">{task.qualityScore !== null ? `${task.qualityScore}/5` : 'pending'}</span>
        </div>
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Dispute</span>
          {task.dispute ? (
            <span className="text-[var(--color-danger)]">{formatStatusLabel(task.dispute.status)}: {task.dispute.reason}</span>
          ) : <span className="text-[var(--color-text-3)]">none</span>}
        </div>
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Task ID</span>
          <span className="text-[var(--color-text-2)] break-all">{task.id}</span>
        </div>
      </div>
    </div>
  );
}
