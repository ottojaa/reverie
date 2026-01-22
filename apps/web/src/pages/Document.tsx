import { useParams } from '@tanstack/react-router';
import { FileText, ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function DocumentPage() {
  const { id } = useParams({ from: '/document/$id' });

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/browse">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Document Details</h1>
          <p className="text-muted-foreground">Viewing document: {id}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
        <div className="flex flex-col items-center text-center">
          <FileText className="size-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-medium">Document preview</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Document content will be displayed here
          </p>
        </div>
      </div>
    </div>
  );
}
