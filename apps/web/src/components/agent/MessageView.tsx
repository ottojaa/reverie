import { cn } from '@/lib/utils';
import type { AgentItem, AgentMessage } from '@reverie/shared';
import { AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ToolCallRow } from './ToolCallRow';

/** Tailwind has no typography plugin here, so the few markdown elements the agent writes are styled by hand. */
const MARKDOWN_CLASSES = cn(
    'min-w-0 break-words text-sm leading-relaxed',
    '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
    '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
    '[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8em]',
    '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
    '[&_a]:text-primary [&_a]:underline [&_strong]:font-semibold',
    '[&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold',
);

function Items({ items }: { items: AgentItem[] }) {
    return (
        <div className="flex flex-col gap-2">
            {items.map((item, index) =>
                item.type === 'tool' ? (
                    <ToolCallRow key={item.id} tool={item} />
                ) : (
                    <div key={index} className={MARKDOWN_CLASSES}>
                        <ReactMarkdown>{item.text}</ReactMarkdown>
                    </div>
                ),
            )}
        </div>
    );
}

function ErrorLine({ message }: { message: string }) {
    return (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words">{message}</span>
        </div>
    );
}

export function MessageView({ message }: { message: AgentMessage }) {
    if (message.role === 'user') {
        const text = message.items.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n');

        return (
            <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm">{text}</p>
            </div>
        );
    }

    return (
        <div>
            <Items items={message.items} />
            {message.error && <ErrorLine message={message.error} />}
        </div>
    );
}

/** The reply being written right now. */
export function LiveReply({ items }: { items: AgentItem[] }) {
    return (
        <div aria-live="polite" data-testid="live-reply">
            <Items items={items} />
        </div>
    );
}
