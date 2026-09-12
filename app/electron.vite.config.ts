import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

/**
 * 세 덩이로 빌드된다.
 *  main    — Electron 메인 프로세스 (파일·git·dev 서버·claude 스폰). Node 를 쥔다.
 *  preload — 두 개다.
 *            index  : 앱 창(렌더러)에 `window.hm` 을 노출하는 다리.
 *            inject : <webview> 안(사용자 홈페이지) 에 들어가는 오버레이. 선택·호버·측정·React 컴포넌트 추적.
 *  renderer— React 앱 (피그마처럼 생긴 껍데기).
 */
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          inject: resolve(__dirname, 'src/inject/index.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  },
})
