import { AgentPage } from '@/components/agent/AgentPage';
import { useAuth } from '@/lib/auth';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/agent')({
    validateSearch: (search: Record<string, unknown>): { chat?: string } => ({ chat: typeof search.chat === 'string' ? search.chat : undefined }),
    component: AgentRoute,
});

/** Admin only: the agent runs on the owner's Claude plan. The server enforces it too; this keeps others from seeing a dead page. */
function AgentRoute() {
    const { user } = useAuth();
    const { chat } = Route.useSearch();
    const navigate = useNavigate();
    const isAdmin = user?.role === 'admin';

    useEffect(() => {
        if (user && !isAdmin) navigate({ to: '/browse' });
    }, [user, isAdmin, navigate]);

    if (!isAdmin) return null;

    return <AgentPage chatId={chat} onChatChange={(id) => navigate({ to: '/agent', search: { chat: id } })} />;
}
