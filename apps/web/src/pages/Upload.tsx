import { UploadDropzone, UploadFileList } from '@/components/upload';
import { UploadProvider } from '@/lib/upload';

export function UploadPage() {
    return (
        <UploadProvider>
            <div className="flex flex-1 flex-col p-6">
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold">Upload Documents</h1>
                    <p className="text-muted-foreground">Add any files to your collection - images, PDFs, documents, and more</p>
                </div>

                <UploadDropzone className="min-h-[300px]" />

                <UploadFileList />
            </div>
        </UploadProvider>
    );
}
