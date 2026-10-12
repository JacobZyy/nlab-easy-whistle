import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { whistleBridge } from './server/whistle-bridge';

export default defineConfig({
  clearScreen: false,
  plugins: [vue(), tailwindcss(), whistleBridge()],
  server: { host: '127.0.0.1', port: 4317, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
});
