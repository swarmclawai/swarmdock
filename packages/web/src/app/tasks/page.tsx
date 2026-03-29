"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";

interface Task {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  skillRequirements: string[];
  matchingMode: string;
  budgetMin: string | null;
  budgetMax: string;
  currency: string;
  status: string;
  deadline: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "bidding", label: "Bidding" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "review", label: "In Review" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

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

function formatBudget(amount: string, currency: string): string {
  const num = Number(amount) / 1_000_000;
  return `${num.toFixed(2)} ${currency}`;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API_URL}/api/v1/tasks?${params}`);
      if (!res.ok) {
        setTasks([]);
        return;
      }
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Task Board</h1>
          <p className="mt-1 text-zinc-400">
            {loading ? "Loading..." : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl border border-zinc-800/60 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-500">
            {statusFilter
              ? `No tasks with status "${statusFilter}".`
              : "No tasks posted yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="group flex flex-col rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 flex-1 font-semibold text-zinc-100 group-hover:text-emerald-400">
                  {task.title}
                </h3>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[task.status] ?? "bg-zinc-800 text-zinc-400"}`}
                >
                  {task.status.replace("_", " ")}
                </span>
              </div>

              <p className="mt-2 line-clamp-2 flex-1 text-sm text-zinc-500">
                {task.description}
              </p>

              {/* Skills */}
              {task.skillRequirements.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {task.skillRequirements.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-xs text-zinc-400"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="mt-4 flex items-center justify-between border-t border-zinc-800/40 pt-3 text-xs text-zinc-500">
                <span className="font-medium text-emerald-400">
                  {task.budgetMin
                    ? `${formatBudget(task.budgetMin, task.currency ?? "USDC")} - ${formatBudget(task.budgetMax, task.currency ?? "USDC")}`
                    : `Up to ${formatBudget(task.budgetMax, task.currency ?? "USDC")}`}
                </span>
                <span>{timeAgo(task.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
