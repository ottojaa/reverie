import type { ServerSetting } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import {
    buildCapabilityChanges,
    describeDraftProblem,
    isAiProviderSetting,
    isDraftChanged,
    loadCapabilityDefaults,
    loadCapabilityDraft,
    switchProvider,
    toTestRequest,
} from './ai-providers';

function setting(key: string, value: unknown, fallback: unknown = value): ServerSetting {
    return { key, value, default: fallback, overridden: value !== fallback, description: '', updated_at: null, updated_by: null } as ServerSetting;
}

const DEFAULT_SETTINGS = [
    setting('trash.retentionDays', 30),
    setting('llm.summary.provider', 'anthropic'),
    setting('llm.summary.model', 'claude-haiku-5-5'),
    setting('llm.summary.baseUrl', ''),
    setting('llm.image.provider', 'anthropic'),
    setting('llm.image.model', 'claude-haiku-5-5'),
    setting('llm.image.baseUrl', ''),
    setting('llm.image.enabled', false),
];

const LOCAL_SETTINGS = DEFAULT_SETTINGS.map((s) => {
    if (s.key === 'llm.summary.provider') return setting(s.key, 'openai-compatible', 'anthropic');

    if (s.key === 'llm.summary.model') return setting(s.key, 'llama3.1:8b', 'claude-haiku-5-5');

    if (s.key === 'llm.summary.baseUrl') return setting(s.key, 'http://ollama:11434/v1', '');

    return s;
});

describe('loading a capability', () => {
    it('reads the defaults: Claude, its model, no URL, vision as the env default says', () => {
        expect(loadCapabilityDraft(DEFAULT_SETTINGS, 'summary')).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', baseUrl: '', enabled: false });
        expect(loadCapabilityDefaults(DEFAULT_SETTINGS, 'image')).toEqual({ model: 'claude-haiku-5-5', enabled: false });
    });

    it('reads a local setup', () => {
        expect(loadCapabilityDraft(LOCAL_SETTINGS, 'summary')).toEqual({
            provider: 'openai-compatible',
            model: 'llama3.1:8b',
            baseUrl: 'http://ollama:11434/v1',
            enabled: false,
        });
    });

    it('keeps the AI keys out of the generic list', () => {
        expect(DEFAULT_SETTINGS.filter((s) => !isAiProviderSetting(s.key)).map((s) => s.key)).toEqual(['trash.retentionDays']);
    });
});

describe('choosing a provider', () => {
    const defaults = { model: 'claude-haiku-5-5', enabled: false };

    it('starts a local server with an empty model and URL, not the Claude id', () => {
        const draft = switchProvider(loadCapabilityDraft(DEFAULT_SETTINGS, 'summary'), 'openai-compatible', defaults);

        expect(draft).toMatchObject({ provider: 'openai-compatible', model: '', baseUrl: '' });
        expect(describeDraftProblem(draft)).toBe('A model name is required.');
    });

    it('puts the default Claude model back when going back, and drops the local URL', () => {
        const draft = switchProvider(loadCapabilityDraft(LOCAL_SETTINGS, 'summary'), 'anthropic', defaults);

        expect(draft).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', baseUrl: '' });
        expect(describeDraftProblem(draft)).toBeNull();
    });

    it('changes nothing when the same provider is chosen again', () => {
        const draft = loadCapabilityDraft(LOCAL_SETTINGS, 'summary');

        expect(switchProvider(draft, 'openai-compatible', defaults)).toBe(draft);
    });
});

describe('validating a draft', () => {
    const local = { provider: 'openai-compatible' as const, model: 'llama3.1:8b', baseUrl: 'http://ollama:11434/v1', enabled: false };

    it('accepts a complete local draft and a Claude one', () => {
        expect(describeDraftProblem(local)).toBeNull();
        expect(describeDraftProblem({ ...local, provider: 'anthropic', baseUrl: '' })).toBeNull();
    });

    it('wants a base URL and a model for a local server', () => {
        expect(describeDraftProblem({ ...local, baseUrl: ' ' })).toBe('A base URL is required for a local server.');
        expect(describeDraftProblem({ ...local, baseUrl: 'ollama:11434' })).toBe('The base URL must start with http:// or https://.');
        expect(describeDraftProblem({ ...local, model: '  ' })).toBe('A model name is required.');
    });
});

describe('saving a draft', () => {
    const defaults = { model: 'claude-haiku-5-5', enabled: false };

    it('writes the three local keys together', () => {
        const draft = { provider: 'openai-compatible' as const, model: ' llama3.1:8b ', baseUrl: ' http://ollama:11434/v1 ', enabled: false };

        expect(buildCapabilityChanges('summary', draft, defaults)).toEqual({
            set: { 'llm.summary.provider': 'openai-compatible', 'llm.summary.baseUrl': 'http://ollama:11434/v1', 'llm.summary.model': 'llama3.1:8b' },
            reset: [],
        });
    });

    it('switching back to Claude deletes the provider, model and base URL rows, so no local value stays behind', () => {
        const back = switchProvider(loadCapabilityDraft(LOCAL_SETTINGS, 'summary'), 'anthropic', defaults);

        expect(buildCapabilityChanges('summary', back, defaults)).toEqual({
            set: {},
            reset: ['llm.summary.provider', 'llm.summary.baseUrl', 'llm.summary.model'],
        });
    });

    it('keeps a different Claude model as an override', () => {
        const draft = { provider: 'anthropic' as const, model: 'claude-sonnet-5-5', baseUrl: '', enabled: false };

        expect(buildCapabilityChanges('summary', draft, defaults)).toEqual({
            set: { 'llm.summary.model': 'claude-sonnet-5-5' },
            reset: ['llm.summary.provider', 'llm.summary.baseUrl'],
        });
    });

    it('stores the vision switch for images only, and only when it differs from the default', () => {
        const draft = { provider: 'anthropic' as const, model: 'claude-haiku-5-5', baseUrl: '', enabled: true };

        expect(buildCapabilityChanges('image', draft, defaults).set).toEqual({ 'llm.image.enabled': true });
        expect(buildCapabilityChanges('image', { ...draft, enabled: false }, defaults).reset).toContain('llm.image.enabled');
        expect(JSON.stringify(buildCapabilityChanges('summary', draft, defaults))).not.toContain('enabled');
    });
});

describe('what changed', () => {
    it('sees a different provider, model, URL or (images) switch, and ignores the switch for summaries', () => {
        const saved = loadCapabilityDraft(LOCAL_SETTINGS, 'summary');

        expect(isDraftChanged(saved, { ...saved }, 'summary')).toBe(false);
        expect(isDraftChanged(saved, { ...saved, model: 'qwen3' }, 'summary')).toBe(true);
        expect(isDraftChanged(saved, { ...saved, baseUrl: 'http://other/v1' }, 'summary')).toBe(true);
        expect(isDraftChanged(saved, { ...saved, provider: 'anthropic' }, 'summary')).toBe(true);
        expect(isDraftChanged(saved, { ...saved, enabled: true }, 'summary')).toBe(false);
        expect(isDraftChanged(saved, { ...saved, enabled: true }, 'image')).toBe(true);
    });
});

describe('testing a draft', () => {
    it('sends the draft as typed, with no base URL for Claude', () => {
        expect(toTestRequest('image', { provider: 'openai-compatible', model: ' llava:13b ', baseUrl: ' http://ollama:11434/v1 ', enabled: true })).toEqual({
            capability: 'image',
            provider: 'openai-compatible',
            model: 'llava:13b',
            base_url: 'http://ollama:11434/v1',
        });
        expect(toTestRequest('summary', { provider: 'anthropic', model: 'claude-haiku-5-5', baseUrl: 'stale', enabled: false }).base_url).toBe('');
    });
});
