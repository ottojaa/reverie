import { DynamicIcon, dynamicIconImports } from 'lucide-react/dynamic';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Renders section icon: lucide by name, legacy emoji as character, or default FileText. */
interface SectionIconProps {
    value: string | null | undefined;
    className?: string;
}

function isLucideIconName(name: string): name is keyof typeof dynamicIconImports {
    return typeof name === 'string' && name.length > 0 && name in dynamicIconImports;
}

/** Short string (e.g. 1–2 chars) likely legacy emoji; render as text. */
function isLegacyEmoji(value: string): boolean {
    if (value.length <= 0 || value.length > 4) return false;

    const codePoints = [...value];

    return codePoints.length <= 2;
}

export function SectionIcon({ value, className }: SectionIconProps) {
    if (value == null || value === '') {
        return <FileText className={cn('size-4 shrink-0 text-current', className)} aria-hidden />;
    }

    if (isLegacyEmoji(value)) {
        return (
            <span className={cn('inline-flex shrink-0 text-base leading-none', className)} aria-hidden>
                {value}
            </span>
        );
    }

    if (isLucideIconName(value)) {
        return <DynamicIcon name={value} className={cn('size-4 shrink-0 text-current', className)} aria-hidden />;
    }

    return <FileText className={cn('size-4 shrink-0 text-current', className)} aria-hidden />;
}
