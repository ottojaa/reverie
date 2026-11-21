/**
 * Which provider answers each capability, read from the live settings when a job runs. Anthropic is the default, with the
 * models the env names; a self-hoster points a capability at a local OpenAI-compatible server in the admin UI.
 */
import type { LlmCapability, LlmProvider as LlmProviderName } from '@reverie/shared';
import { env } from '../config/env';
import { getSettings } from '../settings/settings.service';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatibleProvider, toOpenAiCompatibleConfig } from './openai-compatible.provider';
import type { LlmProvider } from './provider';

export interface CapabilityConfig {
    provider: LlmProviderName;
    model: string;
    baseUrl: string;
}

export async function loadCapabilityConfig(capability: LlmCapability): Promise<CapabilityConfig> {
    if (capability === 'summary') {
        const s = await getSettings(['llm.summary.provider', 'llm.summary.model', 'llm.summary.baseUrl']);

        return { provider: s['llm.summary.provider'], model: s['llm.summary.model'], baseUrl: s['llm.summary.baseUrl'] };
    }

    const s = await getSettings(['llm.image.provider', 'llm.image.model', 'llm.image.baseUrl']);

    return { provider: s['llm.image.provider'], model: s['llm.image.model'], baseUrl: s['llm.image.baseUrl'] };
}

/** Why a configuration cannot be used, in words for the admin; null when it can. */
export function describeMissingConfig(config: CapabilityConfig): string | null {
    if (config.provider === 'anthropic') return env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set on the server.';

    if (!config.baseUrl) return 'A base URL is required for a local server.';

    return config.model ? null : 'A model name is required for a local server.';
}

export function createProvider(config: CapabilityConfig): LlmProvider {
    const missing = describeMissingConfig(config);

    if (missing) throw new Error('LLM provider is not configured: ' + missing);

    return config.provider === 'anthropic'
        ? new AnthropicProvider(config.model)
        : new OpenAiCompatibleProvider(toOpenAiCompatibleConfig(config.baseUrl, config.model));
}

export async function getProvider(capability: LlmCapability): Promise<LlmProvider> {
    return createProvider(await loadCapabilityConfig(capability));
}

/** Whether the capability's provider can be called at all: the global switch is on and it is configured. */
export async function isCapabilityAvailable(capability: LlmCapability): Promise<boolean> {
    return env.LLM_ENABLED && describeMissingConfig(await loadCapabilityConfig(capability)) === null;
}

/** The "model sees images" setting alone, which the env default of LLM_VISION_ENABLED seeds. */
export async function isVisionSwitchedOn(): Promise<boolean> {
    return (await getSettings(['llm.image.enabled']))['llm.image.enabled'];
}

/** Whether an image may be sent for the image call: switched on and its provider usable. The photo and privacy rules are applied separately, ahead of any call. */
export async function isVisionAvailable(): Promise<boolean> {
    return (await isVisionSwitchedOn()) && (await isCapabilityAvailable('image'));
}
