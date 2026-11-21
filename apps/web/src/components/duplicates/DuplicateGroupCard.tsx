import { Button } from '@/components/ui/button';
import type { DuplicateGroup } from '@reverie/shared';
import { Trash2 } from 'lucide-react';
import { DuplicateMemberTile } from './DuplicateMemberTile';
import { formatSimilarity } from './format';

interface DuplicateGroupCardProps {
    group: DuplicateGroup;
    keepId: string;
    busy: boolean;
    onKeep: (memberId: string) => void;
    onTrashOthers: () => void;
    onDismiss: () => void;
}

export function DuplicateGroupCard({ group, keepId, busy, onKeep, onTrashOthers, onDismiss }: DuplicateGroupCardProps) {
    const others = group.members.length - 1;

    return (
        <section aria-label={`${group.members.length} copies of one picture`} className="rounded-xl bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                    {group.members.length} copies <span className="font-normal text-muted-foreground">· {formatSimilarity(group.min_similarity)}</span>
                </p>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
                        Not duplicates
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onTrashOthers} disabled={busy}>
                        <Trash2 className="size-3.5" />
                        Move {others === 1 ? 'other' : `${others} others`} to Trash
                    </Button>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.members.map((member) => (
                    <DuplicateMemberTile
                        key={member.id}
                        member={member}
                        isKept={member.id === keepId}
                        isSuggested={member.id === group.suggested_keep_id}
                        disabled={busy}
                        onKeep={() => onKeep(member.id)}
                    />
                ))}
            </div>
        </section>
    );
}
