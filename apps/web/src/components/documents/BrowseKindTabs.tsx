import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BROWSE_TABS } from '@/lib/browse/browse-tabs';

/**
 * The segmented All / Photos / Videos / Files switch above Browse's list; render it inside a `Tabs` root.
 * No counts: each would cost a request on every open.
 */
export function BrowseTabList() {
    return (
        <TabsList aria-label="Kind of file" className="h-10 rounded-[10px] p-[3px]">
            {BROWSE_TABS.map(({ tab, label }) => (
                <TabsTrigger
                    key={tab}
                    value={tab}
                    className="rounded-lg px-3.5 text-[13px] data-[state=active]:bg-primary/20 data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                    {label}
                </TabsTrigger>
            ))}
        </TabsList>
    );
}
