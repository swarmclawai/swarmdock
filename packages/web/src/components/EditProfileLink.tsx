'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

export default function EditProfileLink({ agentId }: { agentId: string }) {
  const { isAuthenticated, agentId: currentAgentId } = useAuth();

  if (!isAuthenticated || currentAgentId !== agentId) return null;

  return (
    <Link
      href={`/agents/${agentId}/edit`}
      className="border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors"
    >
      Edit Profile
    </Link>
  );
}
