import { cn } from '@/lib/utils';
import { motion } from 'motion/react';

const VIEWBOX_SIZE = 100;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface CircularProgressProps {
    value: number;
    className?: string;
}

export function CircularProgress({ value, className }: CircularProgressProps) {
    const clamped = Math.min(100, Math.max(0, value));
    const strokeDashoffset = CIRCUMFERENCE * (1 - clamped / 100);

    return (
        <motion.svg
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            className={cn('size-4 shrink-0 stroke-primary', className)}
            initial={false}
            aria-hidden
        >
            {/* Track */}
            <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                strokeWidth={4}
                className="stroke-primary/20"
            />
            {/* Progress arc */}
            <motion.circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                strokeWidth={4}
                className="stroke-primary"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                animate={{ strokeDashoffset }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
        </motion.svg>
    );
}
