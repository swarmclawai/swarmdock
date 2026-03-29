import Link from "next/link";
import { notFound } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";

interface Agent {
  id: string;
  did: string;
  displayName: string;
  description: string | null;
  framework: string | null;
  frameworkVersion: string | null;
  modelProvider: string | null;
  modelName: string | null;
  walletAddress: string;
  trustLevel: number;
  dailySpendingLimit: string | null;
  agentCardUrl: string | null;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string;
  updatedAt: string;
  skills: AgentSkill[];
}

interface AgentSkill {
  id: string;
  skillName: string;
  description: string;
  category: string;
  tags: string[];
  pricingModel: string;
  basePrice: string;
  currency: string;
  examplePrompts: string[];
  tasksCompleted: number;
  avgQualityScore: number | null;
}

interface RatingsSummary {
  ratings: AgentRating[];
  averages: {
    quality: number;
    speed: number;
    communication: number;
    reliability: number;
  } | null;
  count: number;
}

interface AgentRating {
  id: string;
  taskId: string;
  raterId: string;
  qualityScore: number;
  speedScore: number | null;
  communicationScore: number | null;
  reliabilityScore: number | null;
  comment: string | null;
  createdAt: string;
}

async function getAgent(id: string): Promise<Agent | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/agents/${id}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getRatings(id: string): Promise<RatingsSummary | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/ratings/agents/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const TRUST_LABELS: Record<number, string> = {
  0: "Unverified",
  1: "Email Verified",
  2: "Challenge Passed",
  3: "Portfolio Verified",
  4: "Community Endorsed",
};

function formatPrice(price: string, currency: string): string {
  const num = Number(price) / 1_000_000; // USDC has 6 decimals
  return `${num.toFixed(2)} ${currency}`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [agent, ratings] = await Promise.all([getAgent(id), getRatings(id)]);

  if (!agent) {
    notFound();
  }

  const isOnline =
    agent.status === "active" &&
    agent.lastHeartbeat &&
    Date.now() - new Date(agent.lastHeartbeat).getTime() < 5 * 60 * 1000;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-zinc-500">
        <Link href="/agents" className="hover:text-zinc-300">
          Agents
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">{agent.displayName}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {agent.displayName}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                agent.status === "active"
                  ? "bg-emerald-900/50 text-emerald-300"
                  : agent.status === "pending"
                    ? "bg-amber-900/50 text-amber-300"
                    : "bg-zinc-800 text-zinc-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOnline ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
              {agent.status}
            </span>
          </div>
          {agent.description && (
            <p className="mt-3 max-w-2xl text-zinc-400">{agent.description}</p>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailCard label="Framework">
          <span className="text-zinc-100">
            {agent.framework ?? "Unknown"}
            {agent.frameworkVersion && (
              <span className="ml-1 text-zinc-500">
                v{agent.frameworkVersion}
              </span>
            )}
          </span>
        </DetailCard>

        <DetailCard label="Model">
          <span className="text-zinc-100">
            {agent.modelName ?? "Unknown"}
          </span>
          {agent.modelProvider && (
            <span className="mt-0.5 block text-xs text-zinc-500">
              by {agent.modelProvider}
            </span>
          )}
        </DetailCard>

        <DetailCard label="Trust Level">
          <span className="text-emerald-400">
            Level {agent.trustLevel}
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            {TRUST_LABELS[agent.trustLevel] ?? "Unknown"}
          </span>
        </DetailCard>

        <DetailCard label="Wallet">
          <span
            className="font-mono text-sm text-zinc-300"
            title={agent.walletAddress}
          >
            {truncateAddress(agent.walletAddress)}
          </span>
        </DetailCard>
      </div>

      {/* DID */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <span className="text-xs font-medium text-zinc-500">
          Decentralized Identifier
        </span>
        <p className="mt-1 break-all font-mono text-sm text-zinc-400">
          {agent.did}
        </p>
      </div>

      {/* Skills */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Skills{" "}
          <span className="text-zinc-500">({agent.skills.length})</span>
        </h2>

        {agent.skills.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-8 text-center text-zinc-500">
            No skills registered.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {agent.skills.map((skill) => (
              <div
                key={skill.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-zinc-100">
                      {skill.skillName}
                    </h3>
                    <span className="mt-0.5 inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                      {skill.category}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-emerald-400">
                      {formatPrice(skill.basePrice, skill.currency)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {skill.pricingModel}
                    </p>
                  </div>
                </div>

                {skill.description && (
                  <p className="mt-2 text-sm text-zinc-500">
                    {skill.description}
                  </p>
                )}

                {skill.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {skill.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-xs text-zinc-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
                  <span>{skill.tasksCompleted} tasks completed</span>
                  {skill.avgQualityScore !== null && (
                    <span>
                      Quality: {skill.avgQualityScore.toFixed(1)}/5
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ratings */}
      {ratings && ratings.count > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            Ratings{" "}
            <span className="text-zinc-500">({ratings.count})</span>
          </h2>

          {ratings.averages && (
            <div className="grid gap-3 sm:grid-cols-4">
              <ScoreCard
                label="Quality"
                score={ratings.averages.quality}
              />
              <ScoreCard
                label="Speed"
                score={ratings.averages.speed}
              />
              <ScoreCard
                label="Communication"
                score={ratings.averages.communication}
              />
              <ScoreCard
                label="Reliability"
                score={ratings.averages.reliability}
              />
            </div>
          )}

          <div className="space-y-3">
            {ratings.ratings.slice(0, 10).map((rating) => (
              <div
                key={rating.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-zinc-300">
                      Quality: {rating.qualityScore}/5
                    </span>
                    {rating.speedScore !== null && (
                      <span className="text-xs text-zinc-500">
                        Speed: {rating.speedScore}/5
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-600">
                    {new Date(rating.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {rating.comment && (
                  <p className="mt-2 text-sm text-zinc-400">
                    {rating.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DetailCard({
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

function ScoreCard({ label, score }: { label: string; score: number }) {
  const barWidth = (score / 5) * 100;
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <span className="text-sm font-semibold text-zinc-200">
          {score.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}
