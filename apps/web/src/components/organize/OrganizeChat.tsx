import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useOrganizeChatContext } from '@/lib/api/OrganizeChatContext';
import type { ChatMessage } from '@/lib/api/organize';
import { cn } from '@/lib/utils';
import { ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';

const SUGGESTED_PROMPTS = ['Organize my financial documents', 'Organize my photos by country and year', 'Suggest improvements to my folder structure'];

interface OrganizeChatProps {
    chatState: ReturnType<typeof useOrganizeChatContext>;
}

function TypingDots() {
    return (
        <div className="flex items-center gap-1 py-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="size-1.5 rounded-full bg-muted-foreground/40"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
        </div>
    );
}

function StatusBubble({ action }: { action: string }) {
    return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>{action}</span>
        </div>
    );
}

function MessageBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === 'user';

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
        >
            {!isUser && (
                <div className="mr-2 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="size-3.5 text-primary" />
                </div>
            )}
            <div
                className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    isUser ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-card text-foreground border border-border',
                )}
            >
                {message.statusAction ? (
                    <StatusBubble action={message.statusAction} />
                ) : message.isStreaming && !message.content ? (
                    <TypingDots />
                ) : (
                    <span className="whitespace-pre-wrap">{message.content}</span>
                )}
                {message.isStreaming && message.content && (
                    <motion.span
                        className="ml-0.5 inline-block h-3.5 w-0.5 rounded-full bg-current opacity-70"
                        animate={{ opacity: [0, 1] }}
                        transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
                    />
                )}
            </div>
        </motion.div>
    );
}

export function OrganizeChat({ chatState }: OrganizeChatProps) {
    const { messages, isStreaming, error, sendMessage, input, setInput } = chatState;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const hasMessages = messages.length > 0;

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const text = input.trim();

        if (!text || isStreaming) return;

        setInput('');
        sendMessage(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSuggestedPrompt = (prompt: string) => {
        sendMessage(prompt);
    };

    return (
        <div className="flex h-full flex-col">
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
                <AnimatePresence mode="wait">
                    {!hasMessages ? (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex h-full flex-col items-center justify-center gap-6"
                        >
                            <div className="flex flex-col items-center gap-2 text-center">
                                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                                    <Sparkles className="size-6 text-primary" />
                                </div>
                                <p className="text-sm font-medium text-foreground">What would you like to organize?</p>
                                <p className="text-xs text-muted-foreground max-w-[280px]">Describe what to move, or ask for help with your collection.</p>
                            </div>

                            <div className="w-full space-y-1.5">
                                {SUGGESTED_PROMPTS.map((prompt, i) => (
                                    <motion.button
                                        key={prompt}
                                        type="button"
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.06 }}
                                        onClick={() => handleSuggestedPrompt(prompt)}
                                        className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-secondary hover:border-primary/30"
                                    >
                                        {prompt}
                                    </motion.button>
                                ))}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                            {messages.map((message) => (
                                <MessageBubble key={message.id} message={message} />
                            ))}
                            <div ref={messagesEndRef} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Error banner */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="mx-4 mb-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Input area */}
            <div className="border-t border-border p-3">
                <div className="flex items-end gap-2 rounded-2xl border border-input bg-background px-3 py-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring transition-all">
                    <Textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Describe what to organize..."
                        rows={1}
                        disabled={isStreaming}
                        className="flex-1 min-h-0 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 disabled:opacity-50 max-h-32 leading-relaxed"
                        style={{ overflowY: input.split('\n').length > 4 ? 'auto' : 'hidden' }}
                        onInput={(e) => {
                            const el = e.currentTarget;
                            el.style.height = 'auto';
                            el.style.height = `${el.scrollHeight}px`;
                        }}
                    />
                    <Button
                        type="button"
                        size="icon"
                        onClick={handleSend}
                        disabled={!input.trim() || isStreaming}
                        className={cn('size-7 shrink-0 rounded-full', input.trim() && !isStreaming ? '' : 'bg-muted text-muted-foreground')}
                    >
                        {isStreaming ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                    </Button>
                </div>
                <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">Powered by AI · Review before confirming</p>
            </div>
        </div>
    );
}
