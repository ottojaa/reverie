import { createFileRoute } from '@tanstack/react-router';
import { BrowsePage } from '../pages/Browse';

export const Route = createFileRoute('/browse')({
  component: BrowsePage,
});


