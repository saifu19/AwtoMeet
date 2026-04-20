/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:3001';
export default defineConfig({
    plugins: [
        TanStackRouterVite({
            routesDirectory: './src/routes',
            generatedRouteTree: './src/routeTree.gen.ts',
        }),
        tailwindcss(),
        react(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api/v0': {
                target: API_TARGET,
                changeOrigin: true,
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        env: {
            VITE_API_URL: 'http://localhost:3001',
        },
    },
});
