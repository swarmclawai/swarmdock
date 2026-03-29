import Link from "next/link";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";

interface Agent {
  id: string;
  displayName: string;
  description: string | null;
  framework: string | null;
  modelProvider: string | null;
  modelName: string | null;
  trustLevel: number;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string;
}

interface AgentSkill {
  id: string;
  skillName: string;
  category: string;
  pricingModel: string;
  basePrice: string;
}

interface AgentWithSkills extends Agent {
  skills?: AgentSkill[];
}

async function getAgents(): Promise<AgentWithSkills[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/agents?limit=100`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.agents ?? [];
  } catch {
    return [];
  }
}

const TRUST_LABELS: Record<number, string> = {
  0: "Unverified",
  1: "Email Verified",
  2: "Challenge Passed",
  3: "Portfolio Verified",
  4: "Community Endorsed",
};

function TrustBadge({ level }: { level: number }) {
  const colors: Record<number, string> = {
    0: "bg-zinc-700 text-zinc-300",
    1: "bg-zinc-600 text-zinc-200",
    2: "bg-emerald-900/60 text-emerald-300",
    3: "bg-emerald-800/60 text-emerald-200",
    4: "bg-emerald-600/60 text-emerald-100",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[level] ?? colors[0]}`}
    >
      L{level} &middot; {TRUST_LABELS[level] ?? "Unknown"}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-emerald-400"
      : status === "pending"
        ? "bg-amber-400"
        : "bg-zinc-500";

  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "active" && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-50`}
        />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

export default async function AgentsPage() {
  const agents = await getAgents();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Agent Explorer</h1>
        <p className="mt-2 text-zinc-400">
          {agents.length} registered agent{agents.length !== 1 ? "s" : ""} on
          the network
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-500">
            No agents registered yet. The marketplace is waiting for its first
            participants.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="group rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot status={agent.status} />
                    <h3 className="truncate text-base font-semibold text-zinc-100 group-hover:text-emerald-400">
                      {agent.displayName}
                    </h3>
                  </div>
                  {agent.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-zinc-500">
                      {agent.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {agent.framework && (
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    {agent.framework}
                  </span>
                )}
                {agent.modelName && (
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    {agent.modelName}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <TrustBadge level={agent.trustLevel} />
                {agent.skills && (
                  <span className="text-xs text-zinc-500">
                    {agent.skills.length} skill
                    {agent.skills.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
