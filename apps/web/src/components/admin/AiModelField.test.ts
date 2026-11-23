import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiModelField } from './AiModelField';

function render(provider: 'anthropic' | 'openai-compatible', value: string): string {
    return renderToStaticMarkup(
        createElement(AiModelField, { id: 'm', provider, value, placeholder: 'placeholder', disabled: false, onChange: () => undefined }),
    );
}

describe('AiModelField', () => {
    it('is a dropdown showing the friendly name for Claude', () => {
        const html = render('anthropic', 'claude-sonnet-5-5');

        expect(html).toContain('role="combobox"');
        expect(html).toContain('Sonnet 5.5');
        expect(html).not.toContain('<input');
    });

    it('shows a saved model outside the list as itself', () => {
        const html = render('anthropic', 'claude-haiku-4-5');

        expect(html).toContain('role="combobox"');
        expect(html).toContain('claude-haiku-4-5');
    });

    it('is a free-text field for a local server', () => {
        const html = render('openai-compatible', 'llama3.1:8b');

        expect(html).toContain('<input');
        expect(html).toContain('value="llama3.1:8b"');
        expect(html).not.toContain('role="combobox"');
    });
});
