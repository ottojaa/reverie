---
name: web-conventions
description: Web app conventions for the Electron + React 19 desktop app — TanStack Router (file-based) + Query for server state, shadcn/ui components, Tailwind v4, Motion. Load before writing or reviewing any code under `apps/web`, or when building UI/components.
---

# Web App (Electron + React)

Desktop app built with Electron, React 19, Vite, and Tailwind CSS.

## Core Libraries

- **Routing**: TanStack Router (file-based routes in `routes/`)
- **Data Fetching**: TanStack Query for all API calls
- **UI Components**: shadcn/ui (`components/ui/`)
- **Animations**: Motion library - use sparingly for meaningful transitions
- **Styling**: Tailwind CSS v4

## File Structure

```
src/
  routes/        # TanStack Router file-based routes
  pages/         # Page components (legacy, prefer routes/)
  components/
    ui/          # shadcn components
    layout/      # Header, Sidebar, Layout
  hooks/         # Custom React hooks
  services/      # API client, WebSocket service
  lib/           # Utilities
```

## Data Fetching Pattern

Always use TanStack Query for server state:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

function useDocuments(folderId: string) {
    return useQuery({
        queryKey: ['documents', folderId],
        queryFn: () => api.getDocuments(folderId),
    });
}
```

## Component Patterns

- Use shadcn components from `components/ui/`. If a component is not yet installed, install it first: `npx shadcn@latest add <component>`
- **Never use native `<button>`, `<input>`, or `<textarea>`** – always use `Button`, `Input`, and `Textarea` from `components/ui/`. Exception: `motion.button` is fine. For file inputs (e.g. react-dropzone), use `Input {...getInputProps()}` with `className="hidden"` when the input is hidden.
- Functional components only
- Extract reusable logic into custom hooks
- Use Motion for animations, don't overuse - focus on page transitions and meaningful feedback

## Types

Import shared types from `@reverie/shared`:

```typescript
import { DocumentSchema, type Document } from '@reverie/shared';
```

## Electron

- Main process: `electron/main.ts`
- Preload: `electron/preload.ts`
- Dev: `yarn dev:electron` (runs both Vite and Electron)
