import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const TAURI_DEV_PORT = 1420

export default defineConfig({
    plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '18' }]] } })],
    clearScreen: false,
    server: {
        port: TAURI_DEV_PORT,
        strictPort: true,
        watch: { ignored: ['**/src-tauri/**'] },
    },
})
