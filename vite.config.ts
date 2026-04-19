import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              // React 核心 - 同步加载
              'vendor-react': ['react', 'react-dom'],
              // Lucide 图标 - 同步加载（UI必需）
              'vendor-icons': ['lucide-react'],
              // Capacitor 原生功能 - 同步加载
              'vendor-capacitor': ['@capacitor/core', '@capacitor/haptics', '@capacitor/local-notifications'],
            }
          }
        },
        // recharts 和 react-calendar-heatmap 不在 manualChunks 中
        // 它们会被懒加载的 Dashboard 组件自动分离到异步 chunk
        chunkSizeWarningLimit: 400,
      }
    };
});
