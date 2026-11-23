import {
    CLAUDE_MODELS,
    type ClaudeModelOption,
    type LlmCapability,
    type LlmProvider,
    type ServerSetting,
    type TestLlmConnectionRequest,
    type UpdateServerSettingsRequest,
} from '@reverie/shared';

/** What the admin sees and edits for one capability; `enabled` ("model sees images") exists for images only. */
export interface CapabilityDraft {
    provider: LlmProvider;
    model: string;
    baseUrl: string;
    enabled: boolean;
}

export interface CapabilityDefaults {
    model: string;
    enabled: boolean;
}

const AI_KEY_PREFIX = 'llm.';

/** The AI provider keys have their own card, so the generic settings list leaves them out. */
export function isAiProviderSetting(key: string): boolean {
    return key.startsWith(AI_KEY_PREFIX);
}

function keyOf(capability: LlmCapability, field: 'provider' | 'model' | 'baseUrl' | 'enabled'): string {
    return AI_KEY_PREFIX + capability + '.' + field;
}

function findSetting(settings: ServerSetting[], capability: LlmCapability, field: 'provider' | 'model' | 'baseUrl' | 'enabled'): ServerSetting | undefined {
    return settings.find((setting) => setting.key === keyOf(capability, field));
}

export function loadCapabilityDefaults(settings: ServerSetting[], capability: LlmCapability): CapabilityDefaults {
    return {
        model: String(findSetting(settings, capability, 'model')?.default ?? ''),
        enabled: findSetting(settings, capability, 'enabled')?.default === true,
    };
}

/** The capability as the server holds it now. */
export function loadCapabilityDraft(settings: ServerSetting[], capability: LlmCapability): CapabilityDraft {
    const provider = findSetting(settings, capability, 'provider')?.value;

    return {
        provider: provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
        model: String(findSetting(settings, capability, 'model')?.value ?? ''),
        baseUrl: String(findSetting(settings, capability, 'baseUrl')?.value ?? ''),
        enabled: findSetting(settings, capability, 'enabled')?.value === true,
    };
}

/**
 * Picking a provider starts that provider's fields clean. The model and base URL are shared keys: a local model name
 * (or a Claude id) left behind would be sent to the other kind of server, so a local server starts with both empty
 * and Claude with its default model.
 */
export function switchProvider(draft: CapabilityDraft, provider: LlmProvider, defaults: CapabilityDefaults): CapabilityDraft {
    if (provider === draft.provider) return draft;

    return { ...draft, provider, model: provider === 'anthropic' ? defaults.model : '', baseUrl: '' };
}

/** Why the draft cannot be saved or tested, in words for the admin; null when it can. */
export function describeDraftProblem(draft: CapabilityDraft): string | null {
    if (!draft.model.trim()) return 'A model name is required.';

    if (draft.provider === 'anthropic') return null;

    const url = draft.baseUrl.trim();

    if (!url) return 'A base URL is required for a local server.';

    return /^https?:\/\/\S+$/.test(url) ? null : 'The base URL must start with http:// or https://.';
}

export function isDraftChanged(saved: CapabilityDraft, draft: CapabilityDraft, capability: LlmCapability): boolean {
    if (saved.provider !== draft.provider || saved.model.trim() !== draft.model.trim() || saved.baseUrl.trim() !== draft.baseUrl.trim()) return true;

    return capability === 'image' && saved.enabled !== draft.enabled;
}

/**
 * The settings to write for a draft, as one atomic change. Claude is the default, so choosing it deletes the provider and
 * base URL rows (and the model row when it is the default model) instead of saving values that could go stale.
 */
export function buildCapabilityChanges(capability: LlmCapability, draft: CapabilityDraft, defaults: CapabilityDefaults): UpdateServerSettingsRequest {
    const set: Record<string, unknown> = {};
    const reset: string[] = [];
    const model = draft.model.trim();

    if (draft.provider === 'openai-compatible') {
        set[keyOf(capability, 'provider')] = 'openai-compatible';
        set[keyOf(capability, 'baseUrl')] = draft.baseUrl.trim();
        set[keyOf(capability, 'model')] = model;
    } else {
        reset.push(keyOf(capability, 'provider'), keyOf(capability, 'baseUrl'));

        if (model === defaults.model) reset.push(keyOf(capability, 'model'));
        else set[keyOf(capability, 'model')] = model;
    }

    if (capability !== 'image') return { set, reset };

    if (draft.enabled === defaults.enabled) reset.push(keyOf(capability, 'enabled'));
    else set[keyOf(capability, 'enabled')] = draft.enabled;

    return { set, reset };
}

export function toTestRequest(capability: LlmCapability, draft: CapabilityDraft): TestLlmConnectionRequest {
    return { capability, provider: draft.provider, model: draft.model.trim(), base_url: draft.provider === 'anthropic' ? '' : draft.baseUrl.trim() };
}

/**
 * The Claude models the picker offers. A saved model outside the supported list (the env can still point at an older
 * one as a rollback) gets its own entry, so opening and saving the card never swaps it for another model.
 */
export function toModelChoices(model: string): ClaudeModelOption[] {
    const saved = model.trim();

    if (!saved || CLAUDE_MODELS.some((option) => option.id === saved)) return [...CLAUDE_MODELS];

    return [...CLAUDE_MODELS, { id: saved, label: saved, hint: 'Not in the supported list' }];
}
