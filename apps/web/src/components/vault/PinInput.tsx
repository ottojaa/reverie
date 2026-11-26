import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export const PIN_LENGTH = 4;

type PinInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange' | 'className'> & {
    value: string;
    onValueChange: (value: string) => void;
};

/** A masked field for the four digits of a PIN, drawn as four dots over the input that takes the typing. */
export function PinInput({ value, onValueChange, ...props }: PinInputProps) {
    return (
        <div
            className={cn(
                'border-input dark:bg-input/30 relative flex h-11 w-fit shrink-0 items-center gap-4 rounded-md border px-4 shadow-xs transition-[color,box-shadow]',
                'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] has-aria-invalid:border-destructive',
            )}
        >
            <Input
                {...props}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={value}
                onChange={(event) => onValueChange(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                className="absolute inset-0 h-full opacity-0"
            />
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
                <span
                    key={index}
                    aria-hidden
                    data-filled={index < value.length}
                    className="size-3 rounded-full border-2 border-muted-foreground/50 data-[filled=true]:border-foreground data-[filled=true]:bg-foreground"
                />
            ))}
        </div>
    );
}
