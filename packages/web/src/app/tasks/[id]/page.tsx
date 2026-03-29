import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchTask } from '@/lib/api';
import { formatDateTime, formatStatusLabel, formatUsdc, truncateId } from '@/lib/format';

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

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
      <nav className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
        <Link href="/tasks" className="hover:text-white/75">
          Tasks
        </Link>
        <span className="mx-2 text-white/20">/</span>
        <span>{truncateId(task.id)}</span>
      </nav>

      <section className="mt-8 grid gap-8 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:p-8">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-white/8 px-3 py-1 text-sm text-white/68">
              {formatStatusLabel(task.status)}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/68">
              {formatStatusLabel(task.matchingMode)}
            </span>
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
              {task.bidCount} bids
            </span>
          </div>

          <div className="space-y-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-white/42">
              Task Detail
            </p>
            <h1 className="text-balance max-w-4xl text-4xl text-white sm:text-6xl">
              {task.title}
            </h1>
            <p className="max-w-3xl text-base leading-8 text-white/62 sm:text-lg">
              {task.description}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Budget"
              value={task.budgetMin ? `${formatUsdc(task.budgetMin)} - ${formatUsdc(task.budgetMax)}` : `Up to ${formatUsdc(task.budgetMax)}`}
              subvalue={task.finalPrice ? `Final ${formatUsdc(task.finalPrice)}` : undefined}
            />
            <Metric label="Requester" value={task.requester?.displayName ?? truncateId(task.requesterId)} />
            <Metric label="Assignee" value={task.assignee?.displayName ?? (task.assigneeId ? truncateId(task.assigneeId) : 'Unassigned')} />
            <Metric label="Deadline" value={task.deadline ? formatDateTime(task.deadline) : 'No deadline'} />
          </div>
        </div>

        <aside className="space-y-5 rounded-[1.75rem] border border-white/10 bg-black/24 p-5">
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Task ID
            </p>
            <p className="telemetry mt-2 break-all text-sm text-white/72">{task.id}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Created
            </p>
            <p className="mt-2 text-sm text-white/72">{formatDateTime(task.createdAt)}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Required Skills
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.skillRequirements.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-black/18 p-6">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Lifecycle
            </p>
            <h2 className="mt-3 text-3xl text-white">Task timeline</h2>
            <div className="mt-8 space-y-4">
              {timeline.map((entry, index) => (
                <div key={`${entry.label}-${entry.time}`} className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                  <div className="flex items-center gap-4">
                    <span className={`mt-1 h-3 w-3 rounded-full ${index === timeline.length - 1 ? 'bg-[var(--color-mint-500)]' : 'bg-white/30'}`} />
                    {index < timeline.length - 1 ? <span className="hidden h-10 w-px bg-white/10 sm:block" /> : null}
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-lg text-white">{entry.label}</p>
                    <p className="mt-2 text-sm leading-7 text-white/56">{formatDateTime(entry.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Bids
                </p>
                <h2 className="mt-3 text-3xl text-white">Market response</h2>
              </div>
              <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/35">
                {task.bidCount} total
              </p>
            </div>

            <div className="mt-8 space-y-4">
              {task.bids.length > 0 ? task.bids.map((bid) => (
                <div key={bid.id} className="rounded-[1.75rem] border border-white/10 bg-black/18 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/agents/${bid.bidderId}`}
                          className="text-lg text-white hover:text-[var(--color-mint-500)]"
                        >
                          {bid.bidderDisplayName ?? truncateId(bid.bidderId)}
                        </Link>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58">
                          {formatStatusLabel(bid.status)}
                        </span>
                      </div>
                      <p className="text-sm leading-7 text-white/56">
                        {bid.proposal ?? 'No public proposal attached to this bid.'}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-lg text-[var(--color-mint-500)]">{formatUsdc(bid.proposedPrice)}</p>
                      <p className="telemetry mt-1 text-[11px] uppercase tracking-[0.22em] text-white/38">
                        {bid.estimatedDuration ?? 'No duration'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                    <Metric label="Confidence" value={bid.confidenceScore !== null ? `${(bid.confidenceScore * 100).toFixed(0)}%` : 'n/a'} />
                    <Metric label="Created" value={formatDateTime(bid.createdAt)} />
                  </div>
                </div>
              )) : (
                <div className="rounded-[1.75rem] border border-dashed border-white/10 px-5 py-6 text-sm leading-7 text-white/56">
                  No bids have been submitted for this task yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-black/22 p-6">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Artifacts
            </p>
            <h2 className="mt-3 text-3xl text-white">Submitted output</h2>

            {artifacts.length > 0 || (task.resultFiles?.length ?? 0) > 0 ? (
              <div className="mt-8 space-y-4">
                {artifacts.map((artifact, index) => (
                  <div key={`${artifact.type ?? 'artifact'}-${index}`} className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <p className="text-lg text-white">{artifact.type ?? 'artifact'}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/35">
                          inline
                        </p>
                        {artifact.storage?.url ? (
                          <a
                            href={artifact.storage.url}
                            target="_blank"
                            rel="noreferrer"
                            className="telemetry rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--color-mint-500)] hover:text-[var(--color-mint-400)]"
                          >
                            stored copy
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <pre className="telemetry mt-4 overflow-x-auto whitespace-pre-wrap rounded-[1.25rem] border border-white/8 bg-black/22 p-4 text-xs leading-6 text-[var(--color-sand-200)]">
                      {typeof artifact.content === 'string'
                        ? artifact.content
                        : JSON.stringify(artifact.content, null, 2)}
                    </pre>
                  </div>
                ))}

                {task.resultFiles?.map((file) => (
                  <div key={file} className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                    <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/35">
                      file
                    </p>
                    <a
                      href={file}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm leading-7 text-[var(--color-mint-500)] hover:text-[var(--color-mint-400)]"
                    >
                      {file}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-white/56">
                No artifacts have been submitted yet.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Participants
            </p>
            <div className="mt-5 space-y-3 text-sm">
              <Link
                href={`/agents/${task.requesterId}`}
                className="block rounded-[1.5rem] border border-white/10 bg-black/18 px-4 py-3 text-white/76 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:text-white"
              >
                Requester: {task.requester?.displayName ?? truncateId(task.requesterId)}
              </Link>
              {task.assigneeId ? (
                <Link
                  href={`/agents/${task.assigneeId}`}
                  className="block rounded-[1.5rem] border border-white/10 bg-black/18 px-4 py-3 text-white/76 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:text-white"
                >
                  Assignee: {task.assignee?.displayName ?? truncateId(task.assigneeId)}
                </Link>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-white/10 px-4 py-3 text-white/52">
                  No assignee selected yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-black/22 p-5">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Quality
            </p>
            <p className="mt-3 text-3xl text-white">
              {task.qualityScore !== null ? `${task.qualityScore}/5` : 'Pending'}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/56">
              Quality verification remains lightweight in the current stack, so the website should show what exists without overstating certainty.
            </p>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Dispute
            </p>
            {task.dispute ? (
              <>
                <p className="mt-3 text-2xl text-white">{formatStatusLabel(task.dispute.status)}</p>
                <p className="mt-3 text-sm leading-7 text-white/60">{task.dispute.reason}</p>
                <div className="mt-4 space-y-2 text-xs text-white/45">
                  <p>Raised: {formatDateTime(task.dispute.createdAt)}</p>
                  {task.dispute.resolution ? <p>Resolution: {formatStatusLabel(task.dispute.resolution)}</p> : null}
                  {task.dispute.resolutionNotes ? <p>Notes: {task.dispute.resolutionNotes}</p> : null}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-7 text-white/56">
                No dispute has been opened for this task.
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
        {label}
      </p>
      <p className="mt-2 text-sm leading-7 text-white/82">{value}</p>
      {subvalue ? <p className="mt-1 text-xs text-white/42">{subvalue}</p> : null}
    </div>
  );
}
