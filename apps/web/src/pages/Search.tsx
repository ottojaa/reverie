import { Search as SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function SearchPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Search Documents</h1>
        <p className="text-muted-foreground">
          Find documents by content, date, or category
        </p>
      </div>

      <div className="relative mb-8">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by text, date, category..."
          className="pl-10"
        />
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
        <div className="flex flex-col items-center text-center">
          <SearchIcon className="size-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-medium">Start searching</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter a query to search through your documents
          </p>
        </div>
      </div>
    </div>
  );
}
