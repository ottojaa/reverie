import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useDrafts } from '@/lib/agent/live-store';
import { useAgentLive } from '@/lib/agent/useAgentLive';
import { agentChatKey, useAgentChat, useAgentChats, useAgentStatus, useDeleteAgentChat, useSendAgentMessage, useStopAgentRun } from '@/lib/api/agent';
import { useConfirm } from '@/lib/confirm';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import type { AgentChat, AgentChatDetail } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ChatList } from './ChatList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { LiveReply, MessageView } from './MessageView';
import { StatusBanner } from './StatusBanner';

interface AgentPageProps {
    chatId: string | undefined;
    onChatChange: (chatId: string | undefined) => void;
}

/** Keeps the newest output in view while it streams, unless the reader has scrolled up to read. */
function useStickToBottom(dependency: unknown) {
    const ref = useRef<HTMLDivElement>(null);
    const pinned = useRef(true);

    useEffect(() => {
        const element = ref.current;

        if (element && pinned.current) element.scrollTop = element.scrollHeight;
    }, [dependency]);

    const onScroll = () => {
        const element = ref.current;

        if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    };

    return { ref, onScroll };
}

export function AgentPage({ chatId, onChatChange }: AgentPageProps) {
    useAgentLive();

    const queryClient = useQueryClient();
    const confirm = useConfirm();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [text, setText] = useState('');
    const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

    const status = useAgentStatus(true);
    const chats = useAgentChats(true);
    const detail = useAgentChat(chatId);
    const send = useSendAgentMessage();
    const stop = useStopAgentRun();
    const deleteChat = useDeleteAgentChat();
    const draft = useDrafts()[chatId ?? ''];

    const messages = detail.data?.messages ?? [];
    const running = !!draft || !!detail.data?.running || send.isPending;
    const state = status.data?.state ?? 'ready';
    const blocked = state === 'ready' ? undefined : state === 'not_signed_in' ? 'The agent is not signed in' : 'The agent is not reachable';
    const scroll = useStickToBottom(`${messages.length}:${draft?.items.length}:${JSON.stringify(draft?.items.at(-1))}`);

    // The typed prompt stays on screen until the stored message arrives with the chat.
    useEffect(() => {
        if (messages.length > 0) setPendingPrompt(null);
    }, [messages.length]);

    const submit = () => {
        const prompt = text.trim();

        if (!prompt || running) return;

        setPendingPrompt(prompt);
        setText('');
        send.mutate(
            { chat_id: chatId, prompt },
            {
                onSuccess: (newChatId) => {
                    if (newChatId !== chatId) onChatChange(newChatId);
                },
                onError: () => {
                    setPendingPrompt(null);
                    setText(prompt);
                },
            },
        );
    };

    const selectChat = (id: string | undefined) => {
        setPendingPrompt(null);
        setHistoryOpen(false);
        onChatChange(id);
    };

    const removeChat = async (chat: AgentChat) => {
        const ok = await confirm({
            title: 'Delete this chat?',
            description: `"${chat.title}" is removed from the history. Changes the agent made to your library stay as they are.`,
            confirmText: 'Delete chat',
            variant: 'destructive',
        });

        if (!ok) return;

        deleteChat.mutate(chat.id, {
            onSuccess: () => {
                queryClient.removeQueries({ queryKey: agentChatKey(chat.id) });

                if (chat.id === chatId) onChatChange(undefined);
            },
        });
    };

    const list = <ChatList chats={chats.data} loading={chats.isLoading} activeId={chatId} onSelect={selectChat} onDelete={removeChat} />;
    const showEmpty = !chatId && !pendingPrompt;
    const showPending = pendingPrompt && (!chatId || messages.length === 0);

    return (
        <div className="flex h-full min-h-0">
            {isDesktop && <aside className="w-64 shrink-0 border-r border-border bg-sidebar/40">{list}</aside>}

            <section className="flex min-w-0 flex-1 flex-col" aria-label="Agent chat">
                {!isDesktop && (
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <h1 className="text-sm font-semibold">Agent</h1>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                            <History className="size-4" />
                            History
                        </Button>
                    </div>
                )}

                {state !== 'ready' && <StatusBanner state={state} onRecheck={() => status.refetch()} checking={status.isFetching} />}

                <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
                    {showEmpty ? (
                        <EmptyState onPick={setText} />
                    ) : (
                        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-3 py-5 sm:px-4">
                            {chatId && detail.isLoading && <Skeleton className="h-16 w-full" />}
                            <Thread detail={detail.data} />
                            {showPending && <MessageView message={toUserMessage(pendingPrompt)} />}
                            {draft && <LiveReply items={draft.items} />}
                            {running && !draft?.items.length && <WorkingDots />}
                        </div>
                    )}
                </div>

                <Composer
                    value={text}
                    onChange={setText}
                    onSubmit={submit}
                    onStop={() => chatId && stop.mutate(chatId)}
                    running={running}
                    disabledReason={blocked}
                />
            </section>

            {!isDesktop && (
                <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
                    <DrawerContent className="h-[70dvh]">
                        <DrawerHeader>
                            <DrawerTitle>History</DrawerTitle>
                        </DrawerHeader>
                        {list}
                    </DrawerContent>
                </Drawer>
            )}
        </div>
    );
}

function Thread({ detail }: { detail: AgentChatDetail | undefined }) {
    return (
        <>
            {detail?.messages.map((message) => (
                <MessageView key={message.id} message={message} />
            ))}
        </>
    );
}

function toUserMessage(prompt: string) {
    return { id: 'pending', role: 'user' as const, items: [{ type: 'text' as const, text: prompt }], error: null, created_at: new Date().toISOString() };
}

function WorkingDots() {
    return (
        <p className="text-sm text-muted-foreground" role="status" data-testid="agent-working">
            Working…
        </p>
    );
}
