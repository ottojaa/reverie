import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { AgentChat } from '@reverie/shared';
import { MessageSquarePlus, Trash2 } from 'lucide-react';

interface ChatListProps {
    chats: AgentChat[] | undefined;
    loading: boolean;
    activeId: string | undefined;
    onSelect: (id: string | undefined) => void;
    onDelete: (chat: AgentChat) => void;
}

/** Per-chat history: newest first, one row per conversation. */
export function ChatList({ chats, loading, activeId, onSelect, onDelete }: ChatListProps) {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="p-3">
                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => onSelect(undefined)}>
                    <MessageSquarePlus className="size-4" />
                    New chat
                </Button>
            </div>
            <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {loading && (
                    <div className="space-y-2 px-1">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                        ))}
                    </div>
                )}
                {!loading && chats?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No chats yet.</p>}
                <ul className="space-y-0.5">
                    {chats?.map((chat) => (
                        <li key={chat.id} className="group relative">
                            <Button
                                type="button"
                                variant="ghost"
                                className={cn(
                                    'h-8 w-full justify-start truncate px-3 pr-9 font-normal hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
                                    chat.id === activeId && 'bg-secondary',
                                )}
                                aria-current={chat.id === activeId ? 'true' : undefined}
                                onClick={() => onSelect(chat.id)}
                            >
                                <span className="truncate">{chat.title}</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="absolute right-0.5 top-0 size-8 opacity-0 hover:bg-transparent focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                                aria-label={'Delete chat: ' + chat.title}
                                onClick={() => onDelete(chat)}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    );
}
