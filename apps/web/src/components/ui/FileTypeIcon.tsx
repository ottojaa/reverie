import { cn } from '@/lib/utils';
import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from 'lucide-react';

/**
 * File type configuration with icon and colors
 */
interface FileTypeConfig {
    icon: LucideIcon;
    color: string;
    bgColor: string;
    label: string;
}

/**
 * Get file type configuration from MIME type
 */
export function getFileTypeConfig(mimeType: string): FileTypeConfig {
    // Images
    if (mimeType.startsWith('image/')) {
        return {
            icon: FileImage,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
            label: 'Image',
        };
    }

    // PDF
    if (mimeType === 'application/pdf') {
        return {
            icon: FileText,
            color: 'text-red-500',
            bgColor: 'bg-red-500/10',
            label: 'PDF',
        };
    }

    // Video
    if (mimeType.startsWith('video/')) {
        return {
            icon: FileVideo,
            color: 'text-purple-500',
            bgColor: 'bg-purple-500/10',
            label: 'Video',
        };
    }

    // Audio
    if (mimeType.startsWith('audio/')) {
        return {
            icon: FileAudio,
            color: 'text-green-500',
            bgColor: 'bg-green-500/10',
            label: 'Audio',
        };
    }

    // Spreadsheets (Excel, CSV, etc.)
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel') {
        return {
            icon: FileSpreadsheet,
            color: 'text-emerald-600',
            bgColor: 'bg-emerald-600/10',
            label: 'Spreadsheet',
        };
    }

    // Word documents
    if (mimeType.includes('word') || mimeType === 'application/msword' || mimeType.includes('wordprocessingml')) {
        return {
            icon: FileText,
            color: 'text-blue-600',
            bgColor: 'bg-blue-600/10',
            label: 'Document',
        };
    }

    // Code and text files
    if (mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html')) {
        return {
            icon: FileCode,
            color: 'text-gray-600',
            bgColor: 'bg-gray-600/10',
            label: 'Text',
        };
    }

    // Archives
    if (
        mimeType.includes('zip') ||
        mimeType.includes('archive') ||
        mimeType.includes('tar') ||
        mimeType.includes('rar') ||
        mimeType.includes('7z') ||
        mimeType.includes('gzip')
    ) {
        return {
            icon: FileArchive,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-600/10',
            label: 'Archive',
        };
    }

    // Default
    return {
        icon: File,
        color: 'text-gray-400',
        bgColor: 'bg-gray-400/10',
        label: 'File',
    };
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
    const parts = filename.split('.');
    if (parts.length > 1) {
        return parts[parts.length - 1].toUpperCase();
    }
    return '';
}

interface FileTypeIconProps {
    mimeType: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    showBackground?: boolean;
    className?: string;
}

const sizeClasses = {
    sm: 'size-4',
    md: 'size-6',
    lg: 'size-8',
    xl: 'size-12',
};

const bgSizeClasses = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3',
    xl: 'p-4',
};

export function FileTypeIcon({ mimeType, size = 'md', showBackground = false, className }: FileTypeIconProps) {
    const config = getFileTypeConfig(mimeType);
    const Icon = config.icon;

    if (showBackground) {
        return (
            <div className={cn('rounded-lg', config.bgColor, bgSizeClasses[size], className)}>
                <Icon className={cn(sizeClasses[size], config.color)} />
            </div>
        );
    }

    return <Icon className={cn(sizeClasses[size], config.color, className)} />;
}
