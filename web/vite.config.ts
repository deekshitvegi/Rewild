import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web version of Rewild (three.js), on its own. `npm run dev`, then open the page it prints.
export default defineConfig({
    plugins: [react()],
    server: { host: '127.0.0.1' },
});
