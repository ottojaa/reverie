import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { Link, Navigate } from '@tanstack/react-router';
import { FolderOpen, Search, Upload } from 'lucide-react';

export function LandingPage() {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" search={{ error: 'unauthorized_access' }} />;
    }

    return (
        <div className="flex flex-1 flex-col items-center justify-center p-8">
            <div className="max-w-2xl text-center">
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                    Welcome to <span className="text-primary">Reverie</span>
                </h1>
                <p className="mt-4 text-lg text-muted-foreground">
                    Your intelligent document manager. Upload, organize, and search through your documents with advanced OCR and AI capabilities.
                </p>

                <div className="mt-12 grid gap-6 sm:grid-cols-3">
                    <Card className="transition-shadow hover:shadow-lg">
                        <CardHeader className="pb-3 text-center">
                            <Upload className="size-8 text-primary w-full" />
                            <CardTitle className="mt-2 text-lg">Upload</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>Drag and drop your documents for instant processing</CardDescription>
                        </CardContent>
                    </Card>

                    <Card className="transition-shadow hover:shadow-lg">
                        <CardHeader className="pb-3">
                            <FolderOpen className="size-8 text-primary w-full" />
                            <CardTitle className="mt-2 text-lg">Organize</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>Automatically categorize and sort your files</CardDescription>
                        </CardContent>
                    </Card>

                    <Card className="transition-shadow hover:shadow-lg">
                        <CardHeader className="pb-3">
                            <Search className="size-8 text-primary w-full" />
                            <CardTitle className="mt-2 text-lg">Search</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>Find any document instantly with full-text search</CardDescription>
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-10 flex items-center justify-center gap-4">
                    <Button size="lg" asChild>
                        <Link to="/upload">
                            <Upload className="mr-2 size-4" />
                            Upload Documents
                        </Link>
                    </Button>
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/browse">
                            <FolderOpen className="mr-2 size-4" />
                            Browse Files
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
