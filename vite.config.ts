import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'NOVA 智能财务目标导航',
        short_name: 'NOVA',
        description: '无需记账，也知道目标能不能按时实现。',
        theme_color: '#0F6B6D',
        background_color: '#F5F7F8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp(?:\/|$)/],
        runtimeCaching: [{
          urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/') || url.pathname === '/mcp',
          handler: 'NetworkOnly',
          options: { cacheName: 'nova-network-only' },
        }],
      },
    })],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // Express owns the public port; tsx restarts it during local edits.
      hmr: false,
    },
  };
});
