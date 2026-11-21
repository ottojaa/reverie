export function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</p>;
}

export function MetaCell({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div className="min-w-0">
            <MicroLabel>{label}</MicroLabel>
            <p className="mt-0.5 truncate text-xs text-foreground/80" title={title ?? value}>
                {value}
            </p>
        </div>
    );
}
