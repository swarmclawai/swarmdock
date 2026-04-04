'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CLIENT_API_URL, authenticatedFetch } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type McpResource = {
  name: string;
  description: string;
  uri: string;
};

type McpServiceDetail = {
  id: string;
  agentId: string;
  name: string;
  description: string;
  version: string;
  protocol: string;
  endpoint: string;
  tools: McpTool[];
  resources: McpResource[] | null;
  pricingModel: string;
  pricePerCall: string | null;
  pricePerMinute: string | null;
  subscriptionPrice: string | null;
  currency: string;
  category: string;
  tags: string[] | null;
  documentation: string | null;
  callsTotal: string | number;
  callsMonthly: string | number;
  avgResponseTimeMs: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  agent: {
    id: string;
    displayName: string;
    did: string;
    status: string;
  };
};

function formatMicroUsdc(value: string | number | null | undefined): string {
  if (value == null) return 'n/a';
  const num = Number(value) / 1_000_000;
  return `$${num.toFixed(2)}`;
}

function pricingLabel(service: McpServiceDetail): string {
  switch (service.pricingModel) {
    case 'per_call':
      return `${formatMicroUsdc(service.pricePerCall)} per call`;
    case 'per_minute':
      return `${formatMicroUsdc(service.pricePerMinute)} per minute`;
    case 'subscription':
      return `${formatMicroUsdc(service.subscriptionPrice)} / month`;
    default:
      return service.pricingModel;
  }
}

export default function McpDetailPage() {
  const params = useParams<{ id: string }>();
  const { token, isAuthenticated } = useAuth();

  const [service, setService] = useState<McpServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe state
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeMsg, setSubscribeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Tool call state
  const [selectedTool, setSelectedTool] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<{ ok: boolean; data: unknown } | null>(null);

  const fetchService = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${CLIENT_API_URL}/api/v1/mcp-marketplace/services/${params.id}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Service not found');
        throw new Error(`API responded ${res.status}`);
      }
      const data = (await res.json()) as McpServiceDetail;
      setService(data);
      // Pre-select the first tool if available
      const tools = Array.isArray(data.tools) ? data.tools : [];
      if (tools.length > 0 && !selectedTool) {
        setSelectedTool(tools[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load service');
    } finally {
      setLoading(false);
    }
     
  }, [params.id]);

  useEffect(() => {
    fetchService();
  }, [fetchService]);

  async function handleSubscribe() {
    if (!token) return;
    setSubscribing(true);
    setSubscribeMsg(null);
    const res = await authenticatedFetch(
      `/api/v1/mcp-marketplace/services/${params.id}/subscribe`,
      token,
      { method: 'POST' },
    );
    if (res.ok) {
      setSubscribeMsg({ ok: true, text: 'Subscribed successfully' });
    } else {
      setSubscribeMsg({ ok: false, text: res.error });
    }
    setSubscribing(false);
  }

  async function handleCallTool() {
    if (!token || !selectedTool) return;
    setCalling(true);
    setCallResult(null);
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(toolArgs);
    } catch {
      setCallResult({ ok: false, data: 'Invalid JSON arguments' });
      setCalling(false);
      return;
    }
    const res = await authenticatedFetch(
      `/api/v1/mcp-marketplace/services/${params.id}/call`,
      token,
      { method: 'POST', body: { toolName: selectedTool, arguments: parsedArgs } },
    );
    if (res.ok) {
      setCallResult({ ok: true, data: res.data });
    } else {
      setCallResult({ ok: false, data: res.error });
    }
    setCalling(false);
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
        <p className="mono text-sm text-[var(--color-text-3)]">Loading service...</p>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
        <nav className="mono text-xs text-[var(--color-text-3)]">
          <Link href="/mcp" className="hover:text-[var(--color-text-2)] transition-colors">MCP Marketplace</Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--color-text-2)]">Not Found</span>
        </nav>
        <p className="mono mt-6 text-sm text-[var(--color-text-3)]">{error ?? 'Service not found.'}</p>
      </div>
    );
  }

  const tools: McpTool[] = Array.isArray(service.tools) ? service.tools : [];
  const resources: McpResource[] = Array.isArray(service.resources) ? service.resources : [];
  const currentTool = tools.find((t) => t.name === selectedTool) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb */}
      <nav className="mono text-xs text-[var(--color-text-3)]">
        <Link href="/mcp" className="hover:text-[var(--color-text-2)] transition-colors">MCP Marketplace</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--color-text-2)]">{service.name}</span>
      </nav>

      {/* Title + status */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
          {service.name}
        </h1>
        <span
          className="mono inline-block border px-2 py-1 text-xs font-medium uppercase tracking-wide"
          style={{
            borderColor: service.status === 'active' ? 'var(--color-success)' : 'var(--color-muted)',
            color: service.status === 'active' ? 'var(--color-success)' : 'var(--color-muted)',
          }}
        >
          {service.status}
        </span>
      </div>

      <hr className="mt-4 border-[var(--color-border)]" />

      {/* Meta line */}
      <p className="mono mt-4 text-sm text-[var(--color-text-2)]">
        v{service.version}
        {' \u00b7 '}{service.category}
        {' \u00b7 '}<span className="text-[var(--color-accent)]">{pricingLabel(service)}</span>
        {' \u00b7 '}{service.protocol.toUpperCase()}
        {' \u00b7 '}
        <Link href={`/agents/${service.agent.id}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
          {service.agent.displayName}
        </Link>
      </p>

      {/* Description */}
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-[var(--color-text-2)]">
        {service.description}
      </p>

      {service.tags && service.tags.length > 0 && (
        <p className="mono mt-3 text-xs text-[var(--color-text-3)]">
          Tags: {service.tags.join(' \u00b7 ')}
        </p>
      )}

      {/* Stats */}
      <div className="mt-6 flex flex-wrap gap-6">
        <div>
          <span className="mono text-xs text-[var(--color-text-3)]">Total Calls</span>
          <p className="mono text-lg text-[var(--color-text)]">{Number(service.callsTotal).toLocaleString()}</p>
        </div>
        <div>
          <span className="mono text-xs text-[var(--color-text-3)]">Monthly Calls</span>
          <p className="mono text-lg text-[var(--color-text)]">{Number(service.callsMonthly).toLocaleString()}</p>
        </div>
        <div>
          <span className="mono text-xs text-[var(--color-text-3)]">Avg Response</span>
          <p className="mono text-lg text-[var(--color-text)]">
            {service.avgResponseTimeMs != null ? `${service.avgResponseTimeMs}ms` : 'n/a'}
          </p>
        </div>
        <div>
          <span className="mono text-xs text-[var(--color-text-3)]">Endpoint</span>
          <p className="mono text-sm text-[var(--color-text-2)] break-all">{service.endpoint}</p>
        </div>
      </div>

      {service.documentation && (
        <p className="mono mt-3 text-sm">
          <a
            href={service.documentation}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] hover:brightness-125"
          >
            Documentation &#8599;
          </a>
        </p>
      )}

      {/* Subscribe */}
      {service.pricingModel === 'subscription' && (
        <div className="mt-8">
          <button
            onClick={handleSubscribe}
            disabled={subscribing || !isAuthenticated}
            className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {subscribing ? 'Subscribing...' : 'Subscribe'}
          </button>
          {!isAuthenticated && (
            <span className="mono ml-3 text-xs text-[var(--color-text-3)]">Sign in to subscribe</span>
          )}
          {subscribeMsg && (
            <span
              className={`mono ml-3 text-xs ${subscribeMsg.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
            >
              {subscribeMsg.text}
            </span>
          )}
        </div>
      )}

      {/* Tools */}
      <div className="mt-10 border-t border-[var(--color-border)] pt-6">
        <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
          Tools ({tools.length})
        </h2>
        {tools.length === 0 ? (
          <p className="mono mt-3 text-sm text-[var(--color-text-3)]">No tools published.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="mono text-sm font-medium text-[var(--color-accent)]">{tool.name}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-2)]">{tool.description}</p>
                {tool.inputSchema && Object.keys(tool.inputSchema).length > 0 && (
                  <pre className="mono mt-2 overflow-x-auto border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-text-3)]">
                    {JSON.stringify(tool.inputSchema, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resources */}
      {resources.length > 0 && (
        <div className="mt-10 border-t border-[var(--color-border)] pt-6">
          <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
            Resources ({resources.length})
          </h2>
          <div className="mt-4 space-y-3">
            {resources.map((resource) => (
              <div
                key={resource.name}
                className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                <span className="mono text-sm font-medium text-[var(--color-text)]">{resource.name}</span>
                <p className="mt-1 text-sm text-[var(--color-text-2)]">{resource.description}</p>
                <p className="mono mt-1 text-xs text-[var(--color-text-3)] break-all">{resource.uri}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call Tool */}
      <div className="mt-10 border-t border-[var(--color-border)] pt-6">
        <h2 className="font-display text-xl font-bold text-[var(--color-text)]">Call Tool</h2>
        {!isAuthenticated ? (
          <p className="mono mt-3 text-sm text-[var(--color-text-3)]">
            Sign in to call tools on this service.
          </p>
        ) : tools.length === 0 ? (
          <p className="mono mt-3 text-sm text-[var(--color-text-3)]">No tools available to call.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mono block text-xs text-[var(--color-text-3)] mb-1">Tool</label>
              <select
                value={selectedTool}
                onChange={(e) => {
                  setSelectedTool(e.target.value);
                  setCallResult(null);
                }}
                className="w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              >
                {tools.map((tool) => (
                  <option key={tool.name} value={tool.name}>{tool.name}</option>
                ))}
              </select>
            </div>

            {currentTool && currentTool.inputSchema && Object.keys(currentTool.inputSchema).length > 0 && (
              <div>
                <label className="mono block text-xs text-[var(--color-text-3)] mb-1">Expected Schema</label>
                <pre className="mono overflow-x-auto border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-text-3)]">
                  {JSON.stringify(currentTool.inputSchema, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <label className="mono block text-xs text-[var(--color-text-3)] mb-1">Arguments (JSON)</label>
              <textarea
                value={toolArgs}
                onChange={(e) => setToolArgs(e.target.value)}
                rows={5}
                className="w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors font-[var(--font-mono)]"
                placeholder='{"key": "value"}'
              />
            </div>

            <button
              onClick={handleCallTool}
              disabled={calling || !selectedTool}
              className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {calling ? 'Calling...' : 'Execute'}
            </button>

            {callResult && (
              <div
                className={`mt-2 border p-4 ${
                  callResult.ok
                    ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                    : 'border-[var(--color-danger)] bg-[var(--color-danger)]/5'
                }`}
              >
                <span className={`mono text-xs font-medium ${callResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {callResult.ok ? 'Success' : 'Error'}
                </span>
                <pre className="mono mt-2 overflow-x-auto text-xs text-[var(--color-text-2)]">
                  {typeof callResult.data === 'string'
                    ? callResult.data
                    : JSON.stringify(callResult.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="mt-10 border-t border-[var(--color-border)] pt-6">
        <h2 className="font-display text-xl font-bold text-[var(--color-text)]">Details</h2>
        <div className="mono mt-4 space-y-2 text-sm">
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Service ID</span>
            <span className="text-[var(--color-text-2)] break-all">{service.id}</span>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Provider</span>
            <Link href={`/agents/${service.agent.id}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
              {service.agent.displayName}
            </Link>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">DID</span>
            <span className="text-[var(--color-text-2)] break-all">{service.agent.did}</span>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Pricing</span>
            <span className="text-[var(--color-accent)]">{pricingLabel(service)}</span>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Currency</span>
            <span className="text-[var(--color-text-2)]">{service.currency}</span>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Created</span>
            <span className="text-[var(--color-text-2)]">
              {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(service.createdAt))}
            </span>
          </div>
          <div className="flex gap-4">
            <span className="w-24 shrink-0 text-[var(--color-text-3)]">Updated</span>
            <span className="text-[var(--color-text-2)]">
              {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(service.updatedAt))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
