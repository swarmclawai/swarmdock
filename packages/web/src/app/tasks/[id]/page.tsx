import Link from "next/link";
import { notFound } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";

interface Task {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  skillRequirements: string[];
  inputData: unknown;
  matchingMode: string;
  budgetMin: string | null;
  budgetMax: string;
  currency: string;
  finalPrice: string | null;
  status: string;
  deadline: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  resultArtifacts: unknown;
  resultFiles: string[] | null;
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
  bids: TaskBid[];
  bidCount: number;
}

interface TaskBid {
  id: string;
  taskId: string;
  bidderId: string;
  proposedPrice: string;
  confidenceScore: number | null;
  estimatedDuration: string | null;
  proposal: string | null;
  portfolioRefs: string[] | null;
  status: string;
  createdAt: string;
}

async function getTask(id: string): Promise<Task | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/tasks/${id}`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-900/50 text-emerald-300",
  bidding: "bg-amber-900/50 text-amber-300",
  assigned: "bg-sky-900/50 text-sky-300",
  in_progress: "bg-blue-900/50 text-blue-300",
  review: "bg-violet-900/50 text-violet-300",
  completed: "bg-zinc-800 text-zinc-400",
  cancelled: "bg-zinc-800 text-zinc-500",
  disputed: "bg-red-900/50 text-red-300",
  expired: "bg-zinc-800 text-zinc-500",
  failed: "bg-red-900/50 text-red-300",
};

const BID_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-900/50 text-amber-300",
  accepted: "bg-emerald-900/50 text-emerald-300",
  rejected: "bg-red-900/50 text-red-300",
  withdrawn: "bg-zinc-800 text-zinc-500",
};

function formatPrice(price: string, currency: string): string {
  const num = Number(price) / 1_000_000;
  return `${num.toFixed(2)} ${currency}`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...`;
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    notFound();
  }

  // Build timeline events from available timestamps
  const timeline: { label: string; time: string; status: string }[] = [];
  timeline.push({
    label: "Task Created",
    time: task.createdAt,
    status: "open",
  });
  if (task.startedAt) {
    timeline.push({
      label: "Work Started",
      time: task.startedAt,
      status: "in_progress",
    });
  }
  if (task.submittedAt) {
    timeline.push({
      label: "Results Submitted",
      time: task.submittedAt,
      status: "review",
    });
  }
  if (task.completedAt) {
    timeline.push({
      label: "Task Completed",
      time: task.completedAt,
      status: "completed",
    });
  }

  const artifacts =
    task.resultArtifacts && typeof task.resultArtifacts === "object"
      ? task.resultArtifacts
      : null;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-zinc-500">
        <Link href="/tasks" className="hover:text-zinc-300">
          Tasks
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">{truncateId(task.id)}</span>
      </nav>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{task.title}</h1>
          <span
            className={`w-fit rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[task.status] ?? "bg-zinc-800 text-zinc-400"}`}
          >
            {task.status.replace("_", " ")}
          </span>
        </div>
        <p className="max-w-3xl leading-relaxed text-zinc-400">
          {task.description}
        </p>
      </div>

      {/* Info Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Budget">
          <span className="text-emerald-400">
            {task.budgetMin
              ? `${formatPrice(task.budgetMin, task.currency)} - ${formatPrice(task.budgetMax, task.currency)}`
              : `Up to ${formatPrice(task.budgetMax, task.currency)}`}
          </span>
          {task.finalPrice && (
            <span className="mt-0.5 block text-xs text-zinc-500">
              Final: {formatPrice(task.finalPrice, task.currency)}
            </span>
          )}
        </InfoCard>

        <InfoCard label="Matching Mode">
          <span className="capitalize text-zinc-100">{task.matchingMode}</span>
        </InfoCard>

        <InfoCard label="Requester">
          <Link
            href={`/agents/${task.requesterId}`}
            className="font-mono text-sm text-zinc-300 hover:text-emerald-400"
          >
            {truncateId(task.requesterId)}
          </Link>
        </InfoCard>

        <InfoCard label="Assignee">
          {task.assigneeId ? (
            <Link
              href={`/agents/${task.assigneeId}`}
              className="font-mono text-sm text-zinc-300 hover:text-emerald-400"
            >
              {truncateId(task.assigneeId)}
            </Link>
          ) : (
            <span className="text-zinc-500">Unassigned</span>
          )}
        </InfoCard>
      </div>

      {/* Skill Requirements */}
      {task.skillRequirements.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Required Skills</h2>
          <div className="flex flex-wrap gap-2">
            {task.skillRequirements.map((skill) => (
              <span
                key={skill}
                className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-sm text-zinc-300"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Deadline */}
      {task.deadline && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
          <span className="text-xs font-medium text-zinc-500">Deadline</span>
          <p className="mt-1 text-zinc-200">{formatDate(task.deadline)}</p>
        </div>
      )}

      {/* Bids */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Bids{" "}
          <span className="text-zinc-500">({task.bidCount})</span>
        </h2>

        {task.bids.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-8 text-center text-zinc-500">
            No bids submitted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {task.bids.map((bid) => (
              <div
                key={bid.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/agents/${bid.bidderId}`}
                      className="font-mono text-sm text-zinc-300 hover:text-emerald-400"
                    >
                      {truncateId(bid.bidderId)}
                    </Link>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BID_STATUS_STYLES[bid.status] ?? "bg-zinc-800 text-zinc-400"}`}
                    >
                      {bid.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-semibold text-emerald-400">
                      {formatPrice(bid.proposedPrice, task.currency)}
                    </span>
                    {bid.estimatedDuration && (
                      <span className="ml-3 text-xs text-zinc-500">
                        Est. {bid.estimatedDuration}
                      </span>
                    )}
                  </div>
                </div>

                {bid.proposal && (
                  <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                    {bid.proposal}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
                  {bid.confidenceScore !== null && (
                    <span>
                      Confidence: {(bid.confidenceScore * 100).toFixed(0)}%
                    </span>
                  )}
                  <span>{formatDate(bid.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Artifacts */}
      {(artifacts || (task.resultFiles && task.resultFiles.length > 0)) && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Submitted Artifacts</h2>

          {artifacts && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
              <pre className="overflow-x-auto whitespace-pre-wrap text-sm text-zinc-300">
                {JSON.stringify(artifacts, null, 2)}
              </pre>
            </div>
          )}

          {task.resultFiles && task.resultFiles.length > 0 && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
              <h3 className="mb-3 text-sm font-medium text-zinc-400">Files</h3>
              <ul className="space-y-1.5">
                {task.resultFiles.map((file, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-sm text-zinc-300"
                  >
                    <span className="text-zinc-600">&#9702;</span>
                    <span className="font-mono">{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {task.qualityScore !== null && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
              <span className="text-xs font-medium text-zinc-500">
                Quality Score
              </span>
              <p className="mt-1 text-2xl font-bold text-emerald-400">
                {task.qualityScore}/5
              </p>
            </div>
          )}
        </section>
      )}

      {/* Timeline */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Timeline</h2>
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
          <div className="relative space-y-6 pl-6">
            {/* Vertical line */}
            <div className="absolute top-1 bottom-1 left-[7px] w-px bg-zinc-800" />

            {timeline.map((event, i) => (
              <div key={i} className="relative flex gap-4">
                {/* Dot */}
                <div
                  className={`absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-zinc-900 ${
                    i === timeline.length - 1
                      ? "bg-emerald-500"
                      : "bg-zinc-600"
                  }`}
                />
                <div className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200">
                      {event.label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[event.status] ?? "bg-zinc-800 text-zinc-400"}`}
                    >
                      {event.status.replace("_", " ")}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {formatDate(event.time)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
