import { useUpload } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';

export function UploadFAB() {
    const inputRef = useRef<HTMLInputElement>(null);
    const { addFiles, openModal, files, stats } = useUpload();

    const hasFiles = files.length > 0;
    const completedCount = stats.complete;
    const totalCount = files.length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const handleClick = () => {
        if (hasFiles) {
            openModal();
        } else {
            inputRef.current?.click();
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files;
        if (selected?.length) {
            addFiles(Array.from(selected));
        }
        e.target.value = '';
    };

    return (
        <>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFileChange} tabIndex={-1} aria-hidden />

            <motion.button
                type="button"
                onClick={handleClick}
                className={cn(
                    'fixed bottom-6 right-6 z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-shadow hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background md:size-14',
                )}
                aria-label={hasFiles ? 'View upload progress' : 'Upload files'}
                initial={false}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                {/* Progress ring when there are files */}
                {hasFiles && totalCount > 0 && (
                    <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="4" className="opacity-20" />
                        <motion.circle
                            cx="50"
                            cy="50"
                            r="46"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={289}
                            initial={{ strokeDashoffset: 289 }}
                            animate={{ strokeDashoffset: 289 * (1 - progressPercent / 100) }}
                            transition={{ duration: 0.3 }}
                            className="text-primary-foreground"
                        />
                    </svg>
                )}

                <Upload className="relative size-6" />
            </motion.button>
        </>
    );
}
