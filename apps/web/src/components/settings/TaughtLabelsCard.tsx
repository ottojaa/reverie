import { Tag } from 'lucide-react';
import { useState } from 'react';
import { useTaughtLabels } from '../../lib/api/taught-labels';
import { TaughtLabelsDialog } from '../taught-labels/TaughtLabelsDialog';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

/** Entry to the taught-labels manager. Labels are taught from a document's toolbar or a multi-selection. */
export function TaughtLabelsCard() {
    const [isOpen, setIsOpen] = useState(false);
    const { data: labels } = useTaughtLabels();
    const count = labels?.length ?? 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Taught labels</CardTitle>
                <CardDescription>
                    Mark a few images with a label of your own and every image that looks like them gets it, now and as new ones arrive.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{count === 0 ? 'No labels yet.' : count === 1 ? '1 label.' : `${count} labels.`}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
                    <Tag className="size-4" />
                    Manage labels
                </Button>
            </CardContent>
            <TaughtLabelsDialog open={isOpen} onOpenChange={setIsOpen} />
        </Card>
    );
}
