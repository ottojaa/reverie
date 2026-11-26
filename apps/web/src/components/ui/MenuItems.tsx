import type { LucideIcon } from 'lucide-react';
import { Fragment, type ComponentType, type ReactNode } from 'react';

export interface MenuEntry {
    label: string;
    icon: LucideIcon;
    /** Left out for an entry that is shown disabled. */
    onSelect?: () => void;
    isDestructive?: boolean;
}

/** The parts a context menu and a dropdown menu share. */
interface MenuParts {
    Item: ComponentType<{ variant?: 'default' | 'destructive'; disabled?: boolean; onSelect?: () => void; children: ReactNode }>;
    Separator: ComponentType;
}

/** One list of actions as the items of either kind of menu, with a separator above a destructive one. */
export function MenuItems({ entries, Item, Separator }: MenuParts & { entries: MenuEntry[] }) {
    return entries.map(({ label, icon: Icon, onSelect, isDestructive }) => (
        <Fragment key={label}>
            {isDestructive && <Separator />}
            <Item variant={isDestructive ? 'destructive' : 'default'} disabled={!onSelect} {...(onSelect && { onSelect })}>
                <Icon className="size-4" />
                {label}
            </Item>
        </Fragment>
    ));
}
