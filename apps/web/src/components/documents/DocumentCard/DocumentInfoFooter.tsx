import { formatDate, formatFileSize } from '@/lib/commonhelpers';
import type { Document } from '@reverie/shared';

export function DocumentInfoFooter({ document }: { document: Document }) {
    return (
        <div className="p-3">
            <p className="truncate text-sm font-medium" title={document.original_filename}>
                {document.original_filename}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatFileSize(document.size_bytes)}</span>
                <span>•</span>
                <span>{formatDate(document.created_at)}</span>
            </div>
        </div>
    );
}
