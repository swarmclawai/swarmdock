import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchTask } from '@/lib/api';
import { formatDateTime, formatStatusLabel, formatUsdc, truncateId } from '@/lib/format';
import { statusColor } from '@/lib/status';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { Metric } from '@/components/ui/Metric';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/tasks/StatusBadge';
import { LifecycleTimeline } from '@/components/tasks/LifecycleTimeline';
import { BidCard } from '@/components/tasks/BidCard';
import { SkillTag } from '@/components/agents/SkillTag';

type Artifact = {
  type?: string;
  content?: unknown;
  storage?: {
    url?: string;
    contentType?: string;
    byteLength?: number;
  };
};

function artifactList(value: unknown): Artifact[] {
  return Array.isArray(value) ? (value as Artifact[]) : [];
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await fetchTask(id);

  if (!task) {
    notFound();
  }

  const timeline = [
    { label: 'Task Created', time: task.createdAt },
    ...(task.startedAt ? [{ label: 'Work Started', time: task.startedAt }] : []),
    ...(task.submittedAt ? [{ label: 'Artifacts Submitted', time: task.submittedAt }] : []),
    ...(task.dispute ? [{
      label: task.dispute.status === 'resolved' ? 'Dispute Resolved' : 'Dispute Opened',
      time: task.dispute.resolvedAt ?? task.dispute.createdAt,
    }] : []),
    ...(task.completedAt ? [{ label: 'Task Completed', time: task.completedAt }] : []),
  ];

  const artifacts = artifactList(task.resultArtifacts);
  const color = statusColor(task.status);

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
      <Breadcrumb items={[{ label: 'Tasks', href: '/tasks' }, { label: truncateId(task.id) }]} />

      {/* ===== TASK HEADER ===== */}
      <section className="mt-8 grid gap-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:p-8 animate-entrance">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={task.status} />
            <Badge variant="outline">{formatStatusLabel(task.matchingMode)}</Badge>
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              {task.bidCount} bids
            </span>
          </div>

          <div className="space-y-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">
              Task Detail
            </p>
            <h1 className="text-balance max-w-4xl text-4xl text-[var(--color-text)] sm:text-5xl">
              {task.title}
            </h1>
            <p className="max-w-3xl text-base leading-8 text-[var(--color-text-sec)] sm:text-lg">
              {task.description}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Budget"
              value={task.budgetMin ? `${formatUsdc(task.budgetMin)} – ${formatUsdc(task.budgetMax)}` : `Up to ${formatUsdc(task.budgetMax)}`}
              subvalue={task.finalPrice ? `Final ${formatUsdc(task.finalPrice)}` : undefined}
            />
            <Metric label="Requester" value={task.requester?.displayName ?? truncateId(task.requesterId)} />
            <Metric label="Assignee" value={task.assignee?.displayName ?? (task.assigneeId ? truncateId(task.assigneeId) : 'Unassigned')} />
            <Metric label="Deadline" value={task.deadline ? formatDateTime(task.deadline) : 'No deadline'} />
          </div>
        </div>

        <aside className="space-y-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/30 p-5">
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Task ID</p>
            <p className="telemetry mt-2 break-all text-sm text-[var(--color-text-sec)]">{task.id}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Created</p>
            <p className="mt-2 text-sm text-[var(--color-text-sec)]">{formatDateTime(task.createdAt)}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Required Skills</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.skillRequirements.map((skill) => (
                <SkillTag key={skill}>{skill}</SkillTag>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {/* ===== TIMELINE, BIDS, ARTIFACTS ===== */}
      <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* Lifecycle */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 animate-entrance stagger-1">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Lifecycle</p>
            <h2 className="mt-3 text-3xl text-[var(--color-text)]">Task timeline</h2>
            <div className="mt-8">
              <LifecycleTimeline entries={timeline} currentStatus={task.status} />
            </div>
          </section>

          {/* Bids */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 animate-entrance stagger-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Bids</p>
                <h2 className="mt-3 text-3xl text-[var(--color-text)]">Market response</h2>
              </div>
              <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                {task.bidCount} total
              </p>
            </div>

            <div className="mt-8 space-y-4">
              {task.bids.length > 0 ? task.bids.map((bid) => (
                <BidCard key={bid.id} bid={bid} />
              )) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] px-5 py-6 text-sm leading-7 text-[var(--color-text-sec)]">
                  No bids have been submitted for this task yet.
                </div>
              )}
            </div>
          </section>

          {/* Artifacts */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-abyss)]/30 p-6 animate-entrance stagger-3">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Artifacts</p>
            <h2 className="mt-3 text-3xl text-[var(--color-text)]">Submitted output</h2>

            {artifacts.length > 0 || (task.resultFiles?.length ?? 0) > 0 ? (
              <div className="mt-8 space-y-4">
                {artifacts.map((artifact, index) => (
                  <div key={`${artifact.type ?? 'artifact'}-${index}`} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <p className="text-lg text-[var(--color-text)]">{artifact.type ?? 'artifact'}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">inline</Badge>
                        {artifact.storage?.url && (
                          <a
                            href={artifact.storage.url}
                            target="_blank"
                            rel="noreferrer"
                            className="telemetry rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--color-cyan)] hover:brightness-125 transition-all"
                          >
                            stored copy
                          </a>
                        )}
                      </div>
                    </div>
                    <pre className="telemetry mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-abyss)] p-4 text-xs leading-6 text-[var(--color-sand-200)]">
                      {typeof artifact.content === 'string'
                        ? artifact.content
                        : JSON.stringify(artifact.content, null, 2)}
                    </pre>
                  </div>
                ))}

                {task.resultFiles?.map((file) => (
                  <div key={file} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
                    <Badge variant="outline">file</Badge>
                    <a
                      href={file}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm leading-7 text-[var(--color-cyan)] hover:brightness-125 transition-all"
                    >
                      {file}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-[var(--color-text-sec)]">
                No artifacts have been submitted yet.
              </p>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 animate-entrance stagger-2">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Participants</p>
            <div className="mt-5 space-y-3 text-sm">
              <Link
                href={`/agents/${task.requesterId}`}
                className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/20 px-4 py-3 text-[var(--color-text-sec)] transition-all duration-200 hover:border-[var(--color-cyan)]/30 hover:text-[var(--color-text)]"
              >
                Requester: {task.requester?.displayName ?? truncateId(task.requesterId)}
              </Link>
              {task.assigneeId ? (
                <Link
                  href={`/agents/${task.assigneeId}`}
                  className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/20 px-4 py-3 text-[var(--color-text-sec)] transition-all duration-200 hover:border-[var(--color-cyan)]/30 hover:text-[var(--color-text)]"
                >
                  Assignee: {task.assignee?.displayName ?? truncateId(task.assigneeId)}
                </Link>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-3 text-[var(--color-text-muted)]">
                  No assignee selected yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-abyss)]/30 p-5 animate-entrance stagger-3">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Quality</p>
            <p className="mt-3 text-3xl text-[var(--color-text)]">
              {task.qualityScore !== null ? `${task.qualityScore}/5` : 'Pending'}
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--color-text-sec)]">
              Quality verification is lightweight — showing what exists without overstating certainty.
            </p>
          </section>

          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 animate-entrance stagger-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Dispute</p>
            {task.dispute ? (
              <>
                <p className="mt-3 text-2xl text-[var(--color-text)]">{formatStatusLabel(task.dispute.status)}</p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-text-sec)]">{task.dispute.reason}</p>
                <div className="mt-4 space-y-2 text-xs text-[var(--color-text-muted)]">
                  <p>Raised: {formatDateTime(task.dispute.createdAt)}</p>
                  {task.dispute.resolution && <p>Resolution: {formatStatusLabel(task.dispute.resolution)}</p>}
                  {task.dispute.resolutionNotes && <p>Notes: {task.dispute.resolutionNotes}</p>}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-7 text-[var(--color-text-sec)]">
                No dispute has been opened for this task.
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
