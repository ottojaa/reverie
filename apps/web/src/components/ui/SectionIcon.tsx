import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';
import { DynamicIcon, dynamicIconImports } from 'lucide-react/dynamic';

/** Renders section icon: lucide by name, legacy emoji as character, or default FileText. */
interface SectionIconProps {
    value: string | null | undefined;
    className?: string;
}

function isLucideIconName(name: string): name is keyof typeof dynamicIconImports {
    return typeof name === 'string' && name.length > 0 && name in dynamicIconImports;
}

export function SectionIcon({ value, className }: SectionIconProps) {
    if (value == null || value === '') {
        return <FileText className={cn('size-4 shrink-0 text-current', className)} aria-hidden />;
    }

    if (isLucideIconName(value)) {
        return <DynamicIcon name={value} className={cn('size-4 shrink-0 text-current', className)} aria-hidden />;
    }

    // Emoji or other short character (legacy)
    return (
        <span className={cn('inline-flex size-4 shrink-0 items-center justify-center text-base leading-none', className)} aria-hidden>
            {value}
        </span>
    );
}
