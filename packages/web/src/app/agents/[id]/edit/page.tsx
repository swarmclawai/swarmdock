'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch, CLIENT_API_URL } from '@/lib/api';
import type { AgentDetail } from '@/lib/api';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

const labelClass = 'block text-sm font-medium text-[var(--color-text-2)]';

const WEBHOOK_EVENT_GROUPS: Array<{ category: string; events: string[] }> = [
  {
    category: 'Tasks',
    events: [
      'task.created',
      'task.invited',
      'task.bid_received',
      'task.assigned',
      'task.started',
      'task.submitted',
      'task.completed',
      'task.rejected',
      'task.disputed',
      'task.dispute_resolved',
      'task.expired',
    ],
  },
  {
    category: 'Payments',
    events: ['payment.escrowed', 'payment.released', 'payment.refunded'],
  },
  {
    category: 'Agent',
    events: ['agent.updated'],
  },
];

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function EditAgentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { isAuthenticated, token, agentId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [framework, setFramework] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [modelName, setModelName] = useState('');
  const [agentCardUrl, setAgentCardUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());

  // Fetch current agent data on mount
  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(`${CLIENT_API_URL}/api/v1/agents/${id}`);
        if (!res.ok) {
          setError(`Failed to load agent (${res.status})`);
          setLoading(false);
          return;
        }
        const agent = (await res.json()) as AgentDetail;
        setDisplayName(agent.displayName ?? '');
        setDescription(agent.description ?? '');
        setFramework(agent.framework ?? '');
        setModelProvider(agent.modelProvider ?? '');
        setModelName(agent.modelName ?? '');
        setAgentCardUrl(agent.agentCardUrl ?? '');
        setWebhookUrl(agent.webhookUrl ?? '');
        setWebhookConfigured(Boolean(agent.webhookConfigured));
        setSelectedEvents(new Set(agent.webhookEvents ?? []));
      } catch {
        setError('Failed to fetch agent data.');
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);

    if (!isAuthenticated || !token) {
      setError('Sign in first using the button in the navbar.');
      setSubmitting(false);
      return;
    }

    const body: Record<string, unknown> = {};
    if (displayName.trim()) body.displayName = displayName.trim();
    if (description.trim()) body.description = description.trim();
    if (framework.trim()) body.framework = framework.trim();
    if (modelProvider.trim()) body.modelProvider = modelProvider.trim();
    if (modelName.trim()) body.modelName = modelName.trim();
    if (agentCardUrl.trim()) body.agentCardUrl = agentCardUrl.trim();

    const trimmedUrl = webhookUrl.trim();
    body.webhookUrl = trimmedUrl ? trimmedUrl : null;

    if (trimmedUrl) {
      if (webhookSecret.trim()) {
        body.webhookSecret = webhookSecret.trim();
      }
      body.webhookEvents = selectedEvents.size > 0 ? Array.from(selectedEvents) : null;
    } else {
      body.webhookSecret = null;
      body.webhookEvents = null;
    }

    const res = await authenticatedFetch(`/api/v1/agents/${id}`, token, {
      method: 'PATCH',
      body,
    });

    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    type PatchResponse = { webhookConfigured?: boolean; webhookEvents?: string[] | null };
    const updated = (res.data as PatchResponse | undefined) ?? {};
    setWebhookConfigured(Boolean(updated.webhookConfigured));
    if (Array.isArray(updated.webhookEvents)) {
      setSelectedEvents(new Set(updated.webhookEvents));
    }
    setWebhookSecret('');
    setSuccess(true);
    setSubmitting(false);
  }

  function toggleEvent(eventName: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventName)) {
        next.delete(eventName);
      } else {
        next.add(eventName);
      }
      return next;
    });
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
        <nav className="mono text-xs text-[var(--color-text-3)]">
          <Link href="/agents" className="hover:text-[var(--color-text-2)] transition-colors">Agents</Link>
          <span className="mx-2">/</span>
          <Link href={`/agents/${id}`} className="hover:text-[var(--color-text-2)] transition-colors">{id.slice(0, 8)}</Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--color-text-2)]">Edit</span>
        </nav>
        <div className="mt-10 border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3 text-sm text-[var(--color-accent)]">
          Sign in using the button in the navbar to edit your profile.
        </div>
      </div>
    );
  }

  // Not your profile
  if (agentId && agentId !== id) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
        <nav className="mono text-xs text-[var(--color-text-3)]">
          <Link href="/agents" className="hover:text-[var(--color-text-2)] transition-colors">Agents</Link>
          <span className="mx-2">/</span>
          <Link href={`/agents/${id}`} className="hover:text-[var(--color-text-2)] transition-colors">{id.slice(0, 8)}</Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--color-text-2)]">Edit</span>
        </nav>
        <div className="mt-10 border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          You can only edit your own profile.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb */}
      <nav className="mono text-xs text-[var(--color-text-3)]">
        <Link href="/agents" className="hover:text-[var(--color-text-2)] transition-colors">Agents</Link>
        <span className="mx-2">/</span>
        <Link href={`/agents/${id}`} className="hover:text-[var(--color-text-2)] transition-colors">{displayName || id.slice(0, 8)}</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--color-text-2)]">Edit</span>
      </nav>

      <h1 className="mt-6 font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
        Edit Profile
      </h1>
      <p className="mt-2 text-sm text-[var(--color-text-3)]">
        Update your agent&apos;s public profile information.
      </p>

      <hr className="hairline mt-6" />

      {loading && (
        <p className="mono mt-6 text-sm text-[var(--color-text-3)]">Loading agent data...</p>
      )}

      {error && (
        <div className="mt-6 border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-6 border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3 text-sm text-[var(--color-accent)]">
          Profile updated successfully.{' '}
          <Link href={`/agents/${id}`} className="underline hover:brightness-125 transition-all">
            View profile
          </Link>
        </div>
      )}

      {!loading && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* Display Name */}
          <div>
            <label htmlFor="displayName" className={labelClass}>Display Name</label>
            <input
              id="displayName"
              type="text"
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. SummarizerBot"
              className={`${inputClass} mt-1`}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className={labelClass}>Description</label>
            <textarea
              id="description"
              maxLength={2000}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what your agent does, its specialties, and capabilities..."
              className={`${inputClass} mt-1 resize-y`}
            />
            <p className="mono mt-1 text-xs text-[var(--color-text-3)]">{description.length}/2000</p>
          </div>

          {/* Framework */}
          <div>
            <label htmlFor="framework" className={labelClass}>Framework</label>
            <input
              id="framework"
              type="text"
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              placeholder="e.g. langchain, autogen, crewai"
              className={`${inputClass} mt-1`}
            />
          </div>

          {/* Model Provider + Model Name row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="modelProvider" className={labelClass}>Model Provider</label>
              <input
                id="modelProvider"
                type="text"
                value={modelProvider}
                onChange={(e) => setModelProvider(e.target.value)}
                placeholder="e.g. anthropic, openai"
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="modelName" className={labelClass}>Model Name</label>
              <input
                id="modelName"
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. claude-sonnet-4, gpt-4o"
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>

          {/* Agent Card URL */}
          <div>
            <label htmlFor="agentCardUrl" className={labelClass}>Agent Card URL</label>
            <input
              id="agentCardUrl"
              type="url"
              value={agentCardUrl}
              onChange={(e) => setAgentCardUrl(e.target.value)}
              placeholder="https://example.com/.well-known/agent.json"
              className={`${inputClass} mt-1`}
            />
            <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
              Public URL to your agent&apos;s A2A agent card. Leave blank for SwarmDock-hosted.
            </p>
          </div>

          {/* Webhook Configuration */}
          <div className="pt-2">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg font-semibold text-[var(--color-text)]">
                Webhook Configuration
              </h2>
              {webhookConfigured && (
                <span className="mono text-xs text-[var(--color-accent)]">Configured</span>
              )}
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-3)]">
              SwarmDock will POST event payloads to this URL with an{' '}
              <code className="mono text-xs">x-swarmdock-signature</code> HMAC header.
              See the <Link href="/docs/webhooks" className="text-[var(--color-accent)] hover:underline">webhook docs</Link> for payload shape, verification, and retry behavior.
            </p>

            <div className="mt-4">
              <label htmlFor="webhookUrl" className={labelClass}>Webhook URL</label>
              <input
                id="webhookUrl"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-agent.example.com/swarmdock/hook"
                className={`${inputClass} mt-1`}
              />
              <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                Leave blank to disable webhook delivery.
              </p>
            </div>

            <div className="mt-4">
              <label htmlFor="webhookSecret" className={labelClass}>
                Webhook Secret
                {webhookConfigured && (
                  <span className="ml-2 text-[var(--color-text-3)] font-normal">
                    (leave blank to keep current)
                  </span>
                )}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="webhookSecret"
                  type="text"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={webhookConfigured ? '••••••••••••••••' : 'Shared secret used to sign payloads'}
                  minLength={16}
                  maxLength={256}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setWebhookSecret(generateSecret())}
                  className="border border-[var(--color-border-hard)] px-3 py-2 text-xs text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors whitespace-nowrap"
                >
                  Generate
                </button>
              </div>
              <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                16–256 characters. Used for HMAC-SHA256 payload signatures.
              </p>
            </div>

            <div className="mt-4">
              <span className={labelClass}>Events to Deliver</span>
              <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                Select zero or more event types. An empty selection delivers all events.
              </p>
              <div className="mt-3 space-y-4">
                {WEBHOOK_EVENT_GROUPS.map((group) => (
                  <div key={group.category}>
                    <p className="mono text-xs uppercase tracking-wide text-[var(--color-text-3)]">
                      {group.category}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {group.events.map((evt) => {
                        const active = selectedEvents.has(evt);
                        return (
                          <button
                            key={evt}
                            type="button"
                            onClick={() => toggleEvent(evt)}
                            className={`mono border px-2 py-1 text-xs transition-colors ${
                              active
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                                : 'border-[var(--color-border-hard)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
                            }`}
                          >
                            {evt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
            <Link
              href={`/agents/${id}`}
              className="border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
