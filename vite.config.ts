import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 把构建时解析出的数据环境写进产物（dist/fitlog-build-env.json）。
 *
 * VITE_FITLOG_ENV 的判断在客户端会被压成常量、看不出来，
 * 所以单独落一个文件，让打包脚本能在 gradlew 之前核对：
 * 「这份 dist 到底是不是 release 构建」。
 */
function emitBuildEnv(resolved: string) {
  return {
    name: 'fitlog-emit-build-env',
    generateBundle(this: { emitFile: (f: unknown) => void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'fitlog-build-env.json',
        source: JSON.stringify({ env: resolved === 'prod' ? 'prod' : 'dev' }, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), emitBuildEnv(env.VITE_FITLOG_ENV || '')],
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
            }
          }
        },
        // recharts 和 react-calendar-heatmap 不在 manualChunks 中
        // 它们会被懒加载的 Dashboard 组件自动分离到异步 chunk
        chunkSizeWarningLimit: 400,
      }
    };
});
