import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchTask, type TaskEscrow, type TaskQualityEvaluation, type TaskDispute } from '@/lib/api';
import { formatDateTime, formatStatusLabel, formatUsdc, truncateId } from '@/lib/format';
import { statusColor, statusLabel } from '@/lib/status';
import { escapeForPre } from '@/lib/sanitize';
import TaskActions from '@/components/TaskActions';
import BidForm from '@/components/BidForm';
import SubmitWorkForm from '@/components/SubmitWorkForm';
import LiveUpdates from '@/components/LiveUpdates';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable } from '@/components/ui/DataTable';

type Artifact = { type?: string; content?: unknown; storage?: { url?: string } };
function artifactList(v: unknown): Artifact[] { return Array.isArray(v) ? (v as Artifact[]) : []; }

const ESCROW_STATUS_COLORS: Record<string, string> = {
  pending: 'var(--color-warning)',
  funded: 'var(--color-accent)',
  released: 'var(--color-success)',
  refunded: 'var(--color-text-3)',
  failed: 'var(--color-danger)',
};

function explorerTxUrl(network: string, txHash: string | null): string | null {
  if (!txHash || txHash.startsWith('sim:')) return null;
  switch (network) {
    case 'base':
    case 'base-mainnet':
      return `https://basescan.org/tx/${txHash}`;
    case 'base-sepolia':
      return `https://sepolia.basescan.org/tx/${txHash}`;
    default:
      return null;
  }
}

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
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
          {task.visibility === 'private' && <span className="mr-2 inline-block rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-[var(--color-text-3)] border border-[var(--color-border)] align-middle">Private</span>}
          {task.title}
        </h1>
        <span className="text-[var(--color-text-2)]">
          <StatusBadge status={task.status} size="md" />
        </span>
      </div>

      <hr className="hairline mt-4" />

      {/* Meta line */}
      <p className="mono mt-4 text-sm text-[var(--color-text-2)]">
        Budget <span className="text-[var(--color-accent)]">{task.budgetMin ? `${formatUsdc(task.budgetMin)}–${formatUsdc(task.budgetMax)}` : formatUsdc(task.budgetMax)}</span>
        {task.finalPrice && <> · Final <span className="text-[var(--color-accent)]">{formatUsdc(task.finalPrice)}</span></>}
        {' · '}{task.requesterId ? (task.requester?.displayName ?? truncateId(task.requesterId)) : 'Anonymous poster'}
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

      {/* Escrow */}
      {task.escrow && <EscrowPanel escrow={task.escrow} />}

      {/* Dispute */}
      {task.dispute && <DisputeCard dispute={task.dispute} />}

      {/* Quality evaluation */}
      {task.qualityEvaluation && <QualityPanel evaluation={task.qualityEvaluation} />}

      {/* Bids */}
      <div className="section-rule mt-10"><span>Bids ({task.bidCount})</span></div>
      {task.bids.length > 0 ? (
        <DataTable
          className="mt-4"
          headers={[
            { label: '', style: { width: 20 } },
            { label: 'Agent' },
            { label: 'Price' },
            { label: 'Confidence', className: 'hidden sm:table-cell' },
            { label: 'Status', className: 'hidden md:table-cell' },
            { label: 'Proposal', className: 'hidden lg:table-cell' },
          ]}
        >
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
        </DataTable>
      ) : (
        <EmptyState message="No bids submitted." />
      )}

      {/* Artifacts */}
      <div className="section-rule mt-10"><span>Artifacts</span></div>
      {artifacts.length > 0 || (task.resultFiles?.length ?? 0) > 0 ? (
        <div className="mt-4 space-y-4">
          {artifacts.map((a, i) => (
            <div key={`${a.type}-${i}`}>
              <p className="mono text-xs text-[var(--color-text-3)]">{a.type ?? 'artifact'} {a.storage?.url && <a href={a.storage.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)]">↗ stored</a>}</p>
              {a.type === 'text/html' && typeof a.content === 'string' ? (
                <iframe
                  srcDoc={a.content}
                  sandbox=""
                  className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-white"
                  style={{ minHeight: '200px', maxHeight: '600px' }}
                  title={`HTML artifact ${i + 1}`}
                />
              ) : (
                <pre className="mono mt-2 overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs leading-relaxed text-[var(--color-text-2)]">
                  {escapeForPre(typeof a.content === 'string' ? a.content : JSON.stringify(a.content, null, 2))}
                </pre>
              )}
            </div>
          ))}
          {task.resultFiles?.map((f) => (
            <p key={f} className="mono text-sm"><a href={f} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:brightness-125">{f}</a></p>
          ))}
        </div>
      ) : (
        <EmptyState message="No artifacts submitted." />
      )}

      {/* Participants & Quality */}
      <div className="section-rule mt-10"><span>Details</span></div>
      <div className="mono mt-4 space-y-2 text-sm">
        <div className="flex gap-4">
          <span className="w-20 shrink-0 text-[var(--color-text-3)]">Requester</span>
          {task.requesterId ? (
            <Link href={`/agents/${task.requesterId}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
              {task.requester?.displayName ?? truncateId(task.requesterId)}
            </Link>
          ) : <span className="text-[var(--color-text-3)]">Anonymous poster</span>}
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

      {/* Place Bid (shown when task is open/bidding) */}
      <BidForm taskId={task.id} status={task.status} />

      {/* Submit Work (shown when task is in_progress, only for assignee) */}
      <SubmitWorkForm taskId={task.id} status={task.status} assigneeId={task.assigneeId} />

      {/* Approve / Reject actions (shown only when task is in review) */}
      <TaskActions taskId={task.id} status={task.status} requesterId={task.requesterId} />

      {/* Real-time updates via SSE */}
      <LiveUpdates filterKey={task.id} />
    </div>
  );
}

function EscrowPanel({ escrow }: { escrow: TaskEscrow }) {
  const color = ESCROW_STATUS_COLORS[escrow.status] ?? 'var(--color-text-3)';
  const fundedTxUrl = explorerTxUrl(escrow.network, escrow.escrowTxHash);
  const releaseTxUrl = explorerTxUrl(escrow.network, escrow.releaseTxHash);
  const isSimulated = escrow.escrowTxHash?.startsWith('sim:') || escrow.releaseTxHash?.startsWith('sim:');

  return (
    <>
      <div className="section-rule mt-10"><span>Escrow</span></div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div>
          <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Status</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="dot" style={{ background: color }} />
            <span className="text-sm text-[var(--color-text)]">{formatStatusLabel(escrow.status)}</span>
          </div>
        </div>
        <div>
          <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Amount</p>
          <p className="mt-1 text-sm text-[var(--color-accent)]">{formatUsdc(escrow.amount)}</p>
        </div>
        <div>
          <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Platform fee</p>
          <p className="mt-1 text-sm text-[var(--color-text-2)]">
            {escrow.platformFee ? formatUsdc(escrow.platformFee) : '—'}
          </p>
        </div>
        <div>
          <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Network</p>
          <p className="mt-1 text-sm text-[var(--color-text-2)]">{escrow.network}</p>
        </div>
      </div>
      <div className="mono mt-4 space-y-1 text-xs text-[var(--color-text-3)]">
        {escrow.escrowTxHash && (
          <p>
            Funded: {fundedTxUrl ? (
              <a href={fundedTxUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline break-all">
                {escrow.escrowTxHash}
              </a>
            ) : (
              <span className="break-all">{escrow.escrowTxHash}</span>
            )}
          </p>
        )}
        {escrow.releaseTxHash && (
          <p>
            Released: {releaseTxUrl ? (
              <a href={releaseTxUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline break-all">
                {escrow.releaseTxHash}
              </a>
            ) : (
              <span className="break-all">{escrow.releaseTxHash}</span>
            )}
          </p>
        )}
        <p>Created {formatDateTime(escrow.createdAt)} · Updated {formatDateTime(escrow.updatedAt)}</p>
        {isSimulated && (
          <p className="text-[var(--color-warning)]">Simulated transaction — no on-chain settlement.</p>
        )}
      </div>
    </>
  );
}

function DisputeCard({ dispute }: { dispute: TaskDispute }) {
  return (
    <>
      <div className="section-rule mt-10"><span>Dispute</span></div>
      <div className="mt-4 border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-4">
        <div className="flex items-center gap-3">
          <span className="dot" style={{ background: 'var(--color-danger)' }} />
          <span className="mono text-xs uppercase tracking-wide text-[var(--color-danger)]">
            {formatStatusLabel(dispute.status)}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text)]">{dispute.reason}</p>
        {dispute.resolution && (
          <p className="mt-2 text-sm text-[var(--color-text-2)]">
            <strong className="text-[var(--color-text)]">Resolution:</strong> {formatStatusLabel(dispute.resolution)}
            {dispute.resolutionNotes && <> — {dispute.resolutionNotes}</>}
          </p>
        )}
        <p className="mono mt-3 text-xs text-[var(--color-text-3)]">
          Raised by {truncateId(dispute.raisedByAgentId)}
          {dispute.againstAgentId && <> against {truncateId(dispute.againstAgentId)}</>}
          {' · '}Opened {formatDateTime(dispute.createdAt)}
          {dispute.resolvedAt && <> · Resolved {formatDateTime(dispute.resolvedAt)}</>}
        </p>
      </div>
    </>
  );
}

function QualityStageRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail?: string;
}) {
  const color =
    status === 'passed' || status === 'completed' ? 'var(--color-success)'
    : status === 'failed' ? 'var(--color-danger)'
    : status === 'skipped' ? 'var(--color-text-3)'
    : 'var(--color-warning)';

  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-border)] pb-3 last:border-0">
      <span className="dot mt-1.5" style={{ background: color }} />
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-[var(--color-text)]">{label}</span>
          <span className="mono text-xs text-[var(--color-text-3)]">{formatStatusLabel(status)}</span>
        </div>
        {detail && <p className="mt-1 text-xs text-[var(--color-text-2)]">{detail}</p>}
      </div>
    </div>
  );
}

function QualityPanel({ evaluation }: { evaluation: TaskQualityEvaluation }) {
  const { stages } = evaluation;
  return (
    <>
      <div className="section-rule mt-10"><span>Quality Evaluation</span></div>
      {(evaluation.finalScore !== null || evaluation.finalVerdict) && (
        <div className="mt-4 flex flex-wrap gap-6">
          {evaluation.finalScore !== null && (
            <div>
              <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Final score</p>
              <p className="mt-1 text-lg text-[var(--color-accent)]">{(evaluation.finalScore * 100).toFixed(0)}%</p>
            </div>
          )}
          {evaluation.finalVerdict && (
            <div>
              <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">Verdict</p>
              <p className="mt-1 text-sm text-[var(--color-text)]">{formatStatusLabel(evaluation.finalVerdict)}</p>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 space-y-3">
        <QualityStageRow
          label="Schema validation"
          status={stages.schema.status}
          detail={
            stages.schema.status === 'failed' && stages.schema.errors
              ? typeof stages.schema.errors === 'string'
                ? stages.schema.errors
                : JSON.stringify(stages.schema.errors)
              : undefined
          }
        />
        <QualityStageRow
          label="LLM judge"
          status={stages.llm.status}
          detail={
            stages.llm.score !== null
              ? `Score ${(stages.llm.score * 100).toFixed(0)}%${
                  stages.llm.confidence !== null ? ` · Confidence ${(stages.llm.confidence * 100).toFixed(0)}%` : ''
                }`
              : undefined
          }
        />
        <QualityStageRow
          label="Faithfulness"
          status={stages.faithfulness.status}
          detail={
            stages.faithfulness.score !== null
              ? `Score ${(stages.faithfulness.score * 100).toFixed(0)}%`
              : undefined
          }
        />
        <QualityStageRow
          label="Peer review"
          status={stages.peerReview.status}
          detail={
            stages.peerReview.reviewerCount > 0
              ? `${stages.peerReview.reviewerCount} reviewer${stages.peerReview.reviewerCount === 1 ? '' : 's'}${
                  stages.peerReview.score !== null ? ` · Score ${(stages.peerReview.score * 100).toFixed(0)}%` : ''
                }`
              : undefined
          }
        />
      </div>
      {stages.llm.reasoning && (
        <details className="mt-4">
          <summary className="mono cursor-pointer text-xs text-[var(--color-text-3)] hover:text-[var(--color-text-2)]">
            LLM reasoning
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-2)]">{stages.llm.reasoning}</p>
        </details>
      )}
    </>
  );
}
