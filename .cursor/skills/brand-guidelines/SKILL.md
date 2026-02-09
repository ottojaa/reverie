---
name: brand-guidelines
description: Reverie brand colors and typography. Use when implementing UI components, styling, or visual design decisions.
---

# Reverie Brand Guidelines

## Overview

Reverie uses a modern, minimal aesthetic with deep charcoal dark mode and warm off-white light mode. The design emphasizes content through subtle depth layering rather than heavy borders. Colors are defined in `apps/web/src/styles.css` and exposed via Tailwind `@theme inline`; use the **Tailwind class names** below (they match the CSS variables).

**Keywords**: branding, visual identity, colors, typography, dark mode, light mode, design system

## Colors (Tailwind classes)

The app uses shadcn-style tokens. CSS vars live in `:root` / `.dark` in `styles.css`; Tailwind exposes them as `--color-*` in `@theme inline`, so the classes are the token name with the usual utility prefix.

### Backgrounds

| Purpose        | Tailwind class   | Light value        | Dark value   |
|----------------|------------------|--------------------|--------------|
| App/window     | `bg-background`  | ~#f8f7f4 (warm)    | #121212      |
| Elevated (cards, popovers) | `bg-card` | #ffffff            | #242424      |
| Hover/overlay  | `bg-secondary`   | #f0efe9            | #2e2e2e      |
| Muted areas    | `bg-muted`       | #e8e6e1            | #2a2a2a      |
| Popover surface | `bg-popover`    | same as card       | same as card |

### Text

| Purpose     | Tailwind class           |
|------------|--------------------------|
| Primary    | `text-foreground`        |
| Secondary/descriptions | `text-muted-foreground` |
| On primary button | `text-primary-foreground` |
| On secondary | `text-secondary-foreground` |

### Actions & accents

| Purpose       | Tailwind class              |
|---------------|-----------------------------|
| Primary (teal)| `bg-primary` / `text-primary` / `ring-primary` |
| Secondary (indigo) | `bg-accent` / `text-accent-foreground` |
| Focus ring    | `ring-ring` (teal)          |

### Borders & form

- Border: `border-border`
- Input border: `border-input`
- Focus: `outline-ring` / `ring-ring`

### Semantic

- Success: `text-success` / `bg-success`
- Warning: `text-warning` / `bg-warning`
- Error/destructive: `text-destructive` / `bg-destructive`

### Sidebar

- Background: `bg-sidebar` (or `sidebar` component tokens)
- Hover: `hover:bg-sidebar-accent`
- Text: `text-sidebar-foreground`, `text-sidebar-primary`
- Border: `border-sidebar-border`

## Typography

- **Font**: `font-sans` → Geist (with system fallbacks). Defined in `@theme inline` as `--font-sans: 'Geist', ui-sans-serif, system-ui, sans-serif`.
- **Mono**: `font-mono` → Geist Mono.
- **Sizes**: Use Tailwind text utilities (`text-sm`, `text-base`, etc.). Base radius is `--radius: 0.5rem`; theme also defines `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`.

## Design principles

1. **Depth through layering**: Use `bg-background` → `bg-card` → `bg-secondary` instead of heavy borders.
2. **Minimal borders**: `border-border` only where needed.
3. **Spacing**: 4px base (4, 8, 12, 16, 24, 32, 48).
4. **Accents**: Use `primary` / `accent` for actions and focus, not for large areas.
5. **Contrast**: Keep text on `foreground` / `muted-foreground` for WCAG AA.

## Component patterns

- **Cards**: `bg-card` (no `bg-elevated` – use `bg-card`). Optional `border-border` if needed.
- **Buttons**: Primary = `bg-primary text-primary-foreground`; Secondary = `bg-secondary text-secondary-foreground`; Ghost = transparent + `text-muted-foreground` + `hover:bg-secondary`.
- **Inputs**: `bg-transparent` or `bg-background`, `border-input`, focus `ring-ring`.
- **Sidebar**: `bg-sidebar`; items `hover:bg-sidebar-accent`; active = `bg-sidebar-accent` + left border or `text-sidebar-primary`.

## Reference: CSS variables (styles.css)

For quick lookup, the raw vars are:

- **Light**: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--input`, `--ring`, `--destructive`, `--success`, `--warning`, `--info`, plus `--sidebar-*`.
- **Dark**: Same names, values switched in `.dark`.

All of these are wired into Tailwind via `@theme inline` as `--color-<name>`, so the class is `bg-<name>`, `text-<name>`, etc. (e.g. `bg-card`, `text-muted-foreground`).
