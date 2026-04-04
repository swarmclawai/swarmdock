'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CLIENT_API_URL } from '@/lib/api';

type McpService = {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  pricingModel: string;
  pricePerCall: string | null;
  pricePerMinute: string | null;
  subscriptionPrice: string | null;
  currency: string;
  status: string;
  callsTotal: string | number;
  tags: string[] | null;
};

type McpListResponse = {
  services: McpService[];
  total: number;
};

function formatMicroUsdc(value: string | number | null | undefined): string {
  if (value == null) return 'n/a';
  const num = Number(value) / 1_000_000;
  return `$${num.toFixed(2)}`;
}

function pricingLabel(service: McpService): string {
  switch (service.pricingModel) {
    case 'per_call':
      return `${formatMicroUsdc(service.pricePerCall)}/call`;
    case 'per_minute':
      return `${formatMicroUsdc(service.pricePerMinute)}/min`;
    case 'subscription':
      return `${formatMicroUsdc(service.subscriptionPrice)}/mo`;
    default:
      return service.pricingModel;
  }
}

const CATEGORIES = [
  '', 'data', 'compute', 'storage', 'ai', 'search', 'communication',
  'finance', 'security', 'analytics', 'integration', 'other',
];

export default function McpListPage() {
  const [services, setServices] = useState<McpService[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [submitted, setSubmitted] = useState({ q: '', category: '' });

  const fetchServices = useCallback(async (q: string, cat: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (cat) params.set('category', cat);
      params.set('limit', '50');
      const qs = params.toString();
      const res = await fetch(`${CLIENT_API_URL}/api/v1/mcp-marketplace/services${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      const data = (await res.json()) as McpListResponse;
      setServices(data.services ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
      setServices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices(submitted.q, submitted.category);
  }, [submitted, fetchServices]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted({ q: search, category });
  }

  function handleClear() {
    setSearch('');
    setCategory('');
    setSubmitted({ q: '', category: '' });
  }

  const hasFilters = submitted.q || submitted.category;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
          MCP Marketplace
        </h1>
        <span className="mono text-sm text-[var(--color-text-3)]">
          {loading ? 'loading...' : error ? 'API unavailable' : `${total} services`}
        </span>
      </div>

      {/* Filters */}
      <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services..."
          className="flex-1 min-w-[200px] border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        >
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map((cat) => (
            <option key={cat} value={cat}>
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all"
        >
          Filter
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={handleClear}
            className="border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {/* Service list */}
      <div className="mt-8">
        {error ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            Service feed unavailable — {error}
          </p>
        ) : loading ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Loading services...</p>
        ) : services.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            {hasFilters ? 'No services match the current filters.' : 'No MCP services published yet.'}
          </p>
        ) : (
          <div className="space-y-0">
            {services.map((service) => (
              <Link
                key={service.id}
                href={`/mcp/${service.id}`}
                className="group block border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
              >
                {/* Primary row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span
                    className="dot"
                    style={{
                      background: service.status === 'active' ? 'var(--color-success)' : 'var(--color-muted)',
                    }}
                  />
                  <span className="text-[var(--color-text)] font-medium group-hover:text-[var(--color-accent)] transition-colors">
                    {service.name}
                  </span>
                  <span className="mono text-xs text-[var(--color-text-3)]">v{service.version}</span>
                  <span className="mono text-xs text-[var(--color-text-3)]">{service.category}</span>
                  <span className="mono text-sm text-[var(--color-accent)] ml-auto">
                    {pricingLabel(service)}
                  </span>
                  <span className="mono text-xs text-[var(--color-text-3)]">
                    {Number(service.callsTotal).toLocaleString()} calls
                  </span>
                </div>
                {/* Secondary row */}
                <div className="mt-1.5 pl-[18px]">
                  <p className="text-sm text-[var(--color-text-2)] line-clamp-1">
                    {service.description}
                  </p>
                  {service.tags && service.tags.length > 0 && (
                    <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                      {service.tags.join(' \u00b7 ')}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
