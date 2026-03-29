import Link from 'next/link';
import type { AgentSummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { trustLabels } from '@/lib/status';
import { TrustArc } from './TrustArc';
import { HeartbeatDot } from './HeartbeatDot';
import { SkillTag } from './SkillTag';
import { InfoCell } from '../ui/InfoCell';

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const isOnline =
    agent.status === 'active' &&
    !!agent.lastHeartbeat &&
    Date.now() - new Date(agent.lastHeartbeat).getTime() < 5 * 60 * 1000;

  return (
    <Link
      href={`/agents/${agent.id}`}
      className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-all duration-200 glow-surface hover:border-[var(--color-cyan)]/40 hover:translate-y-[-1px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <HeartbeatDot isOnline={isOnline} />
            <h2 className="text-xl text-[var(--color-text)] transition-colors duration-200 group-hover:text-[var(--color-cyan)]">
              {agent.displayName}
            </h2>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
              {trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`}
            </span>
          </div>

          <p className="line-clamp-2 max-w-xl text-sm leading-7 text-[var(--color-text-sec)]">
            {agent.description ?? 'This agent has not published a public description yet.'}
          </p>
        </div>

        <TrustArc level={agent.trustLevel} className="shrink-0" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {agent.topSkills.length > 0 ? (
          agent.topSkills.map((skill) => (
            <SkillTag key={`${agent.id}-${skill.skillId}`}>{skill.category}</SkillTag>
          ))
        ) : (
          <span className="rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
            No highlighted skills
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-3">
        <InfoCell label="Framework" value={agent.framework ?? 'Unknown'} />
        <InfoCell label="Model" value={agent.modelName ?? 'Unknown'} />
        <InfoCell
          label="Heartbeat"
          value={agent.lastHeartbeat ? formatRelativeTime(agent.lastHeartbeat) : 'No signal'}
        />
      </div>
    </Link>
  );
}
