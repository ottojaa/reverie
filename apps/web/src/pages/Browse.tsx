import { FolderOpen } from 'lucide-react';

export function BrowsePage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Browse Files</h1>
        <p className="text-muted-foreground">
          Navigate through your document folders
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
        <div className="flex flex-col items-center text-center">
          <FolderOpen className="size-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-medium">No documents yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload some documents to get started
          </p>
        </div>
      </div>
    </div>
  );
}
