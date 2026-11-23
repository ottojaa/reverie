import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toModelChoices } from '@/lib/ai-providers';
import type { LlmProvider } from '@reverie/shared';

/**
 * The model of one capability: a pick-list of Claude models for Claude, free text for a local server, whose model
 * names are whatever that server has.
 */
export function AiModelField({
    id,
    provider,
    value,
    placeholder,
    disabled,
    onChange,
}: {
    id: string;
    provider: LlmProvider;
    value: string;
    placeholder: string;
    disabled: boolean;
    onChange: (model: string) => void;
}) {
    if (provider === 'openai-compatible') {
        return <Input id={id} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    }

    const choices = toModelChoices(value);
    const selected = choices.find((choice) => choice.id === value.trim());

    return (
        <Select value={selected?.id ?? ''} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id}>
                <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id} hint={choice.hint}>
                        {choice.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
