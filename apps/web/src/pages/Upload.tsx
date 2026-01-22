import { Upload, FileImage } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function UploadPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Upload Documents</h1>
        <p className="text-muted-foreground">
          Add new documents to your collection
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed transition-colors hover:border-primary/50 hover:bg-muted/50">
        <div className="flex flex-col items-center p-8 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <FileImage className="size-10 text-primary" />
          </div>
          <p className="mt-4 text-lg font-medium">
            Drag and drop your files here
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Supports images (JPG, PNG, TIFF, BMP)
          </p>
          <Button className="mt-6">
            <Upload className="mr-2 size-4" />
            Choose Files
          </Button>
        </div>
      </div>
    </div>
  );
}
