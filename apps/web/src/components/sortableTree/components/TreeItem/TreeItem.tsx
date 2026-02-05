import { cn } from '@/lib/utils';
import React, { forwardRef, HTMLAttributes } from 'react';

import { UniqueIdentifier } from '@dnd-kit/core';

export type DropZoneProp = 'above' | 'center' | 'below' | null;

export interface Props extends Omit<HTMLAttributes<HTMLLIElement>, 'id'> {
    childCount?: number;
    clone?: boolean;
    collapsed?: boolean;
    depth: number;
    disableInteraction?: boolean;
    disableSelection?: boolean;
    dropZone?: DropZoneProp | undefined;
    ghost?: boolean;
    handleProps?: any;
    indicator?: boolean;
    indentationWidth: number;
    isDropTarget?: boolean;
    isHighlighted?: boolean | undefined;
    value: UniqueIdentifier;
    onCollapse?(): void;
    onRemove?(): void;
    wrapperRef?(node: HTMLLIElement): void;
}

const indicatorLineClassName =
    'h-1.5 border-[#2389ff] bg-[#56a1f8] relative before:content-[""] before:absolute before:-left-2 before:-top-1 before:block before:w-3 before:h-3 before:rounded-full before:border before:border-[#2389ff] before:bg-white';

export const TreeItem = forwardRef<HTMLDivElement, Props>(
    (
        {
            childCount,
            clone,
            depth,
            disableSelection,
            disableInteraction,
            dropZone,
            ghost,
            handleProps,
            indentationWidth,
            indicator,
            isDropTarget,
            isHighlighted,
            collapsed,
            onCollapse,
            onRemove,
            style,
            value,
            wrapperRef,
            ...props
        },
        ref,
    ) => {
        const showIndicatorAbove = indicator && dropZone === 'above';
        const showIndicatorBelow = indicator && dropZone === 'below';
        const showCenterHighlight = isHighlighted || dropZone === 'center';

        return (
            <li
                className={cn(
                    'list-none box-border -mb-px',
                    'pl-(--tree-indent)',
                    clone && 'inline-block pointer-events-none p-2 w-full opacity-50',
                    ghost && !clone && 'opacity-30',
                    disableSelection && 'select-none',
                    disableInteraction && 'pointer-events-none',
                )}
                ref={wrapperRef}
                style={
                    {
                        '--tree-indent': `${indentationWidth * depth}px`,
                    } as React.CSSProperties
                }
                {...props}
                {...handleProps}
            >
                {showIndicatorAbove && <div className={cn('-mb-px', indicatorLineClassName)} />}
                <div
                    className={cn(
                        'relative flex items-center box-border bg-white border border-[#dedede] text-[#222]',
                        'py-2.5 px-2.5',
                        clone && 'pr-6 rounded shadow-[0px_15px_15px_0_rgba(34,33,81,0.1)]',
                        showCenterHighlight && 'bg-blue-100 border-[#2389ff]',
                        ghost && !clone && '*:shadow-none *:bg-transparent',
                    )}
                    ref={ref}
                    style={style}
                >
                    <span
                        className={cn(
                            'flex-1 pl-2 whitespace-nowrap text-ellipsis overflow-hidden',
                            (clone || disableSelection) && 'select-none',
                        )}
                    >
                        {value}
                    </span>
                    {clone && childCount && childCount > 1 ? (
                        <span
                            className={cn(
                                'absolute -top-2.5 -right-2.5 flex items-center justify-center w-6 h-6 rounded-full bg-[#2389ff] text-sm font-semibold text-white',
                                (clone || disableSelection) && 'select-none',
                            )}
                        >
                            {childCount}
                        </span>
                    ) : null}
                </div>
                {showIndicatorBelow && <div className={cn('-mt-px', indicatorLineClassName)} />}
            </li>
        );
    },
);
