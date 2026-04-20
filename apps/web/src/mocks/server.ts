import { setupServer } from 'msw/node';
import { createHandlers } from './handlers';

// Tests use VITE_API_URL=http://localhost:3001 (set in vitest config)
export const server = setupServer(
  ...createHandlers('http://localhost:3001'),
);
