import { cn } from '@/lib/utils';
import React, { forwardRef, HTMLAttributes } from 'react';

import { UniqueIdentifier } from '@dnd-kit/core';

export interface Props extends Omit<HTMLAttributes<HTMLLIElement>, 'id'> {
    childCount?: number;
    clone?: boolean;
    collapsed?: boolean;
    depth: number;
    disableInteraction?: boolean;
    disableSelection?: boolean;
    ghost?: boolean;
    handleProps?: any;
    indicator?: boolean;
    indentationWidth: number;
    isDropTarget?: boolean;
    value: UniqueIdentifier;
    onCollapse?(): void;
    onRemove?(): void;
    onRefChange?(element: HTMLElement | null): void;
    wrapperRef?(node: HTMLLIElement): void;
}

export const TreeItem = forwardRef<HTMLDivElement, Props>(
    (
        {
            childCount,
            clone,
            depth,
            disableSelection,
            disableInteraction,
            ghost,
            handleProps,
            indentationWidth,
            indicator,
            isDropTarget,
            collapsed,
            onCollapse,
            onRemove,
            onRefChange,
            style,
            value,
            wrapperRef,
            ...props
        },
        ref,
    ) => {
        const isGhostIndicator = ghost && indicator;

        return (
            <li
                className={cn(
                    'list-none box-border -mb-px',
                    'pl-(--tree-indent)',
                    clone && 'inline-block pointer-events-none p-2 w-full opacity-80',
                    isGhostIndicator && 'opacity-100 relative z-1 -mb-px',
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
                <div
                    className={cn(
                        'relative flex items-center box-border bg-white border border-[#dedede] text-[#222]',
                        !isGhostIndicator && 'py-2.5 px-2.5',
                        clone && !isGhostIndicator && 'pr-6 rounded shadow-[0px_15px_15px_0_rgba(34,33,81,0.1)]',
                        ghost && !indicator && '*:shadow-none *:bg-transparent',
                        isDropTarget && !clone && 'bg-primary/15',
                    )}
                    ref={(el) => {
                        if (typeof ref === 'function') {
                            ref(el);
                        } else if (ref) {
                            ref.current = el;
                        }
                        onRefChange?.(el);
                    }}
                    style={style}
                >
                    <span
                        className={cn(
                            'flex-1 pl-2 whitespace-nowrap text-ellipsis overflow-hidden',
                            isGhostIndicator && 'opacity-0 h-0',
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
            </li>
        );
    },
);
