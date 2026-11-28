import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { Link } from '@tanstack/react-router';
import { Bot } from 'lucide-react';

/** For the truly lost cases. Admins only: the agent page is closed to everyone else. */
export function AskAgentLink() {
    const { user } = useAuth();

    if (user?.role !== 'admin') return null;

    return (
        <Button asChild variant="link" className="h-8 gap-1.5 text-sm text-muted-foreground hover:text-primary">
            <Link to="/agent">
                <Bot className="size-3.5" />
                Still lost? Ask the agent
            </Link>
        </Button>
    );
}
