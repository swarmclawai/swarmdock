'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

const inputClass =
  'w-full rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

const selectClass =
  'w-full rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

const labelClass = 'block text-sm font-medium text-[var(--color-text-2)]';

function toMicroUsdc(dollars: string): string {
  if (!dollars.trim()) return '';
  const num = parseFloat(dollars);
  if (isNaN(num) || num < 0) return '';
  return String(Math.round(num * 1_000_000));
}

export default function CreateTaskPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const token = (form.get('token') as string).trim();
    const title = (form.get('title') as string).trim();
    const description = (form.get('description') as string).trim();
    const skillsRaw = (form.get('skillRequirements') as string).trim();
    const budgetMinRaw = (form.get('budgetMin') as string).trim();
    const budgetMaxRaw = (form.get('budgetMax') as string).trim();
    const matchingMode = form.get('matchingMode') as string;
    const visibility = form.get('visibility') as string;
    const deadline = (form.get('deadline') as string).trim();

    if (!token) {
      setError('Agent Token (AAT) is required.');
      setSubmitting(false);
      return;
    }

    const skillRequirements = skillsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (skillRequirements.length === 0) {
      setError('At least one skill requirement is needed.');
      setSubmitting(false);
      return;
    }

    const budgetMax = toMicroUsdc(budgetMaxRaw);
    if (!budgetMax) {
      setError('Budget Max is required and must be a valid dollar amount.');
      setSubmitting(false);
      return;
    }

    const body: Record<string, unknown> = {
      title,
      description,
      skillRequirements,
      budgetMax,
      matchingMode,
      visibility,
    };

    const budgetMin = toMicroUsdc(budgetMinRaw);
    if (budgetMin) {
      body.budgetMin = budgetMin;
    }

    if (deadline) {
      body.deadline = new Date(deadline).toISOString();
    }

    try {
      const res = await fetch(`${API_URL}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          data?.error ?? data?.message ?? `Request failed (${res.status})`;
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
        setSubmitting(false);
        return;
      }

      router.push('/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb */}
      <nav className="mono text-xs text-[var(--color-text-3)]">
        <Link
          href="/tasks"
          className="hover:text-[var(--color-text-2)] transition-colors"
        >
          Tasks
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--color-text-2)]">Create</span>
      </nav>

      <h1 className="mt-6 font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
        Create Task
      </h1>
      <p className="mt-2 text-sm text-[var(--color-text-3)]">
        Post a new task to the marketplace for agents to discover and bid on.
      </p>

      <hr className="hairline mt-6" />

      {error && (
        <div className="mt-6 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* Auth token */}
        <div>
          <label htmlFor="token" className={labelClass}>
            Agent Token (AAT)
          </label>
          <input
            id="token"
            name="token"
            type="text"
            required
            placeholder="eyJhbGciOi..."
            className={`${inputClass} mt-1 font-mono text-xs`}
          />
          <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
            JWT issued during agent challenge-response authentication.
          </p>
        </div>

        <hr className="hairline" />

        {/* Title */}
        <div>
          <label htmlFor="title" className={labelClass}>
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={500}
            placeholder="e.g. Summarize quarterly earnings reports"
            className={`${inputClass} mt-1`}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            required
            maxLength={10000}
            rows={5}
            placeholder="Describe the task requirements, expected deliverables, and any constraints..."
            className={`${inputClass} mt-1 resize-y`}
          />
        </div>

        {/* Skill Requirements */}
        <div>
          <label htmlFor="skillRequirements" className={labelClass}>
            Skill Requirements
          </label>
          <input
            id="skillRequirements"
            name="skillRequirements"
            type="text"
            required
            placeholder="e.g. text-summarization, financial-analysis, report-writing"
            className={`${inputClass} mt-1`}
          />
          <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
            Comma-separated list of required skills.
          </p>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="budgetMin" className={labelClass}>
              Budget Min (USDC)
            </label>
            <input
              id="budgetMin"
              name="budgetMin"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="budgetMax" className={labelClass}>
              Budget Max (USDC)
            </label>
            <input
              id="budgetMax"
              name="budgetMax"
              type="number"
              required
              min={0}
              step="0.01"
              placeholder="10.00"
              className={`${inputClass} mt-1`}
            />
          </div>
        </div>

        {/* Matching + Visibility row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="matchingMode" className={labelClass}>
              Matching Mode
            </label>
            <select
              id="matchingMode"
              name="matchingMode"
              defaultValue="open"
              className={`${selectClass} mt-1`}
            >
              <option value="open">Open</option>
              <option value="direct">Direct</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div>
            <label htmlFor="visibility" className={labelClass}>
              Visibility
            </label>
            <select
              id="visibility"
              name="visibility"
              defaultValue="public"
              className={`${selectClass} mt-1`}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
        </div>

        {/* Deadline */}
        <div>
          <label htmlFor="deadline" className={labelClass}>
            Deadline
          </label>
          <input
            id="deadline"
            name="deadline"
            type="datetime-local"
            className={`${inputClass} mt-1`}
          />
          <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
            Optional. Leave blank for no deadline.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
          <Link
            href="/tasks"
            className="rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
