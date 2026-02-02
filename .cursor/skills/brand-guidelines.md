---
name: brand-guidelines
description: Reverie brand colors and typography. Use when implementing UI components, styling, or visual design decisions.
---

# Reverie Brand Guidelines

## Overview

Reverie uses a modern, minimal aesthetic with deep charcoal dark mode and warm off-white light mode. The design emphasizes content through subtle depth layering rather than heavy borders.

**Keywords**: branding, visual identity, colors, typography, dark mode, light mode, design system

## Colors

### Dark Mode (Default)

**Backgrounds (layered depth):**

- `--bg-base`: `#121212` - Window/app background
- `--bg-surface`: `#1a1a1a` - Sidebar, main content area
- `--bg-elevated`: `#242424` - Cards, popovers, dropdowns
- `--bg-overlay`: `#2e2e2e` - Hover states, selected items

**Text:**

- `--text-primary`: `#f5f5f5` - Headings, primary content
- `--text-secondary`: `#a0a0a0` - Descriptions, metadata
- `--text-muted`: `#666666` - Disabled, placeholder text

**Borders:**

- `--border-subtle`: `#2a2a2a` - Dividers, subtle separation
- `--border-default`: `#3a3a3a` - Input borders, card outlines

**Accent:**

- `--accent-primary`: `#4fd1c5` - Primary actions, links, active states (teal)
- `--accent-primary-hover`: `#38b2ac` - Hover state
- `--accent-secondary`: `#667eea` - Secondary accent (indigo)

**Semantic:**

- `--success`: `#48bb78` - Success states
- `--warning`: `#ed8936` - Warnings
- `--error`: `#f56565` - Errors, destructive actions
- `--info`: `#4299e1` - Informational

### Light Mode

**Backgrounds (layered depth):**

- `--bg-base`: `#f8f7f4` - Window/app background (warm off-white)
- `--bg-surface`: `#ffffff` - Sidebar, main content area
- `--bg-elevated`: `#ffffff` - Cards, popovers (with shadow)
- `--bg-overlay`: `#f0efe9` - Hover states, selected items

**Text:**

- `--text-primary`: `#1a1a1a` - Headings, primary content
- `--text-secondary`: `#5c5c5c` - Descriptions, metadata
- `--text-muted`: `#9a9a9a` - Disabled, placeholder text

**Borders:**

- `--border-subtle`: `#e8e6e1` - Dividers, subtle separation
- `--border-default`: `#d4d2cc` - Input borders, card outlines

**Accent:**

- `--accent-primary`: `#0d9488` - Primary actions, links (teal, darker for contrast)
- `--accent-primary-hover`: `#0f766e` - Hover state
- `--accent-secondary`: `#4f46e5` - Secondary accent (indigo)

**Semantic:**

- `--success`: `#16a34a`
- `--warning`: `#d97706`
- `--error`: `#dc2626`
- `--info`: `#2563eb`

## Typography

### Font Family

- **Body & UI**: `Geist` (system default fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Monospace**: `Geist Mono` or `'SF Mono', 'Fira Code', monospace`

### Font Sizes

```
--text-xs: 0.75rem    (12px)
--text-sm: 0.875rem   (14px)
--text-base: 1rem     (16px)
--text-lg: 1.125rem   (18px)
--text-xl: 1.25rem    (20px)
--text-2xl: 1.5rem    (24px)
--text-3xl: 1.875rem  (30px)
```

### Font Weights

- Regular: 400 - Body text
- Medium: 500 - UI labels, emphasized text
- Semibold: 600 - Headings, buttons

## Spacing & Radius

### Border Radius

- `--radius-sm`: `4px` - Small elements, tags
- `--radius-md`: `8px` - Buttons, inputs, cards
- `--radius-lg`: `12px` - Modals, large cards
- `--radius-full`: `9999px` - Pills, avatars

### Shadows (Light Mode)

```
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05)
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1)
```

### Shadows (Dark Mode)

Use subtle glow or rely on background layering instead of drop shadows.

## Design Principles

1. **Depth through layering**: Use background color steps instead of heavy borders
2. **Minimal borders**: Only use borders where truly needed for separation
3. **Consistent spacing**: 4px base unit (4, 8, 12, 16, 24, 32, 48)
4. **Subdued accents**: Accent colors used sparingly for actions and focus states
5. **High contrast text**: Ensure WCAG AA compliance for all text

## Component Patterns

### Cards

- Dark: Use `bg-elevated` with no border, subtle `border-subtle` only if needed
- Light: Use `bg-surface` with `shadow-md`

### Buttons

- Primary: `accent-primary` background, white text
- Secondary: `bg-elevated` background, `text-primary`
- Ghost: Transparent, `text-secondary`, hover to `bg-overlay`

### Inputs

- Dark: `bg-surface` background, `border-default` border, focus ring with `accent-primary`
- Light: `bg-surface` background, `border-default` border

### Sidebar

- Dark: `bg-surface` with clear separation from `bg-base`
- Hover items: `bg-overlay`
- Active items: `bg-overlay` + left accent border with `accent-primary`
