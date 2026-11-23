import { AiModelField } from '@/components/admin/AiModelField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/api/admin';
import { getApiErrorMessage } from '@/lib/api/client';
import {
    buildCapabilityChanges,
    describeDraftProblem,
    isDraftChanged,
    loadCapabilityDefaults,
    loadCapabilityDraft,
    switchProvider,
    toTestRequest,
    type CapabilityDraft,
} from '@/lib/ai-providers';
import type { LlmCapability, LlmProvider, ServerSetting, TestLlmConnectionResponse } from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

const CAPABILITIES: { capability: LlmCapability; title: string; description: string }[] = [
    { capability: 'summary', title: 'Summaries and tags', description: 'Reads a document’s text to write its summary, title, entities and tags.' },
    {
        capability: 'image',
        title: 'Image understanding',
        description: 'Looks at screenshots and document images, together with their OCR text, to say what app or source they show.',
    },
];

function TestResult({ result }: { result: TestLlmConnectionResponse }) {
    if (result.ok) {
        return (
            <p role="status" className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                    Connected in {result.latency_ms} ms. The model replied: “{result.reply}”
                </span>
            </p>
        );
    }

    return (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">Connection failed: {result.error}</span>
        </p>
    );
}

/**
 * One capability's provider. The parent keys this on the saved values, so a save re-seeds the draft instead of letting
 * it drift from what the server holds. Test connection sends the draft, not what is saved.
 */
function CapabilityForm({
    capability,
    title,
    description,
    settings,
}: {
    capability: LlmCapability;
    title: string;
    description: string;
    settings: ServerSetting[];
}) {
    const queryClient = useQueryClient();
    const saved = loadCapabilityDraft(settings, capability);
    const defaults = loadCapabilityDefaults(settings, capability);
    const [draft, setDraft] = useState<CapabilityDraft>(saved);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<TestLlmConnectionResponse | null>(null);
    const id = 'ai-' + capability;
    const problem = describeDraftProblem(draft);
    const isLocal = draft.provider === 'openai-compatible';

    const edit = (next: CapabilityDraft) => {
        setDraft(next);
        setError(null);
        setResult(null);
    };

    const save = useMutation({
        mutationFn: () => adminApi.updateSettings(buildCapabilityChanges(capability, draft, defaults)),
        onSuccess: () => {
            toast.success(title + ' saved');

            return queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
        },
        onError: (err) => setError(getApiErrorMessage(err, 'Failed to save')),
    });

    const test = useMutation({
        mutationFn: () => adminApi.testLlmConnection(toTestRequest(capability, draft)),
        onSuccess: setResult,
        onError: (err) =>
            setResult({ ok: false, provider: draft.provider, model: draft.model, latency_ms: 0, reply: null, error: getApiErrorMessage(err, 'Test failed') }),
    });

    const isBusy = save.isPending || test.isPending;
    const isChanged = isDraftChanged(saved, draft, capability);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();

        if (!isChanged || problem || isBusy) return;

        setError(null);
        save.mutate();
    };

    return (
        <form noValidate onSubmit={handleSubmit} aria-labelledby={id + '-title'} className="space-y-4 p-5">
            <div>
                <h3 id={id + '-title'} className="font-medium">
                    {title}
                </h3>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>

            <RadioGroup
                value={draft.provider}
                onValueChange={(value) => edit(switchProvider(draft, value as LlmProvider, defaults))}
                disabled={isBusy}
                aria-label={title + ' provider'}
                className="gap-2"
            >
                <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="anthropic" id={id + '-anthropic'} />
                    Claude (Anthropic API)
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="openai-compatible" id={id + '-local'} />
                    Local server (OpenAI-compatible: Ollama, llama.cpp, vLLM, LM Studio)
                </label>
            </RadioGroup>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <label htmlFor={id + '-model'} className="text-sm font-medium">
                        Model
                    </label>
                    <AiModelField
                        id={id + '-model'}
                        provider={draft.provider}
                        value={draft.model}
                        placeholder={isLocal ? 'e.g. llama3.1:8b' : defaults.model}
                        disabled={isBusy}
                        onChange={(model) => edit({ ...draft, model })}
                    />
                </div>
                {isLocal && (
                    <div className="space-y-1">
                        <label htmlFor={id + '-url'} className="text-sm font-medium">
                            Base URL
                        </label>
                        <Input
                            id={id + '-url'}
                            value={draft.baseUrl}
                            placeholder="http://ollama:11434/v1"
                            disabled={isBusy}
                            onChange={(e) => edit({ ...draft, baseUrl: e.target.value })}
                        />
                    </div>
                )}
            </div>

            {capability === 'image' && (
                <div className="flex items-center gap-3">
                    <Switch id={id + '-enabled'} checked={draft.enabled} disabled={isBusy} onCheckedChange={(enabled) => edit({ ...draft, enabled })} />
                    <label htmlFor={id + '-enabled'} className="text-sm">
                        Model sees images
                        <span className="block text-xs text-muted-foreground">Off: screenshots and documents are summarised from their OCR text only.</span>
                    </label>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={!isChanged || problem !== null || isBusy}>
                    {save.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button type="button" variant="outline" disabled={problem !== null || isBusy} onClick={() => test.mutate()}>
                    {test.isPending ? 'Testing...' : 'Test connection'}
                </Button>
                {isChanged && problem && <span className="text-xs text-muted-foreground">{problem}</span>}
            </div>

            {result && <TestResult result={result} />}
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
        </form>
    );
}

/** Where each background AI capability sends its requests: Claude, or a local OpenAI-compatible server. */
export function AiProvidersCard({ settings, isLoading }: { settings: ServerSetting[]; isLoading: boolean }) {
    return (
        <section aria-labelledby="ai-providers-title" className="mb-8">
            <h2 id="ai-providers-title" className="text-lg font-semibold tracking-tight">
                AI providers
            </h2>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">
                Claude is the default. A capability can use a local model instead, so no document text or image leaves your server. Saving applies right away,
                so press Test connection first: it tries what is typed here, not what is saved.
            </p>
            <p className="mb-3 text-sm text-muted-foreground">
                The same rules apply to every provider, a local one included: photos, images with camera data, images the classifier has not judged, private
                folders and the trash are never sent to a model. If the local server needs a key, set{' '}
                <code className="font-mono text-xs">LOCAL_LLM_API_KEY</code> on the server; it is never stored in the database.
            </p>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                {isLoading && (
                    <div className="space-y-4 p-5">
                        <Skeleton className="h-24 w-full" />
                    </div>
                )}
                {!isLoading &&
                    CAPABILITIES.map((entry) => (
                        <CapabilityForm
                            key={
                                entry.capability + JSON.stringify(settings.filter((s) => s.key.startsWith('llm.' + entry.capability + '.')).map((s) => s.value))
                            }
                            settings={settings}
                            {...entry}
                        />
                    ))}
            </div>
        </section>
    );
}
