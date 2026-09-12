import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as projects from './projects'
import * as dev from './devserver'
import * as claude from './claude'
import * as source from './source'
import * as git from './git'
import * as tokens from './tokens'
import { authInfo } from './auth'
import { readSettings, writeSettings, forgetRecent } from './store'
import { autotest } from './autotest'
import type { ClaudeRequest, StyleChange } from '../shared/types'

/**
 * 메인 프로세스 = 이 앱에서 «Node 를 쥔» 유일한 자리.
 * 렌더러(React 껍데기)와 webview(사용자 홈페이지) 는 둘 다 파일·프로세스에 손 못 댄다. 전부 여기로 ipc 를 친다.
 */
let win: BrowserWindow | null = null

/**
 * 🔴 렌더러에서 `file:///…` 이미지를 못 연다 (Electron 이 막는다 — 조용히 빈 칸이 된다).
 *    첨부 썸네일은 이 전용 스킴으로 읽는다. 읽어 주는 건 «이미지 확장자 + 실제로 있는 파일»뿐이다.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'hm-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
])
const IMG_EXT = /\.(png|jpe?g|webp|gif|avif)$/i

function serveLocalFiles(): void {
  protocol.handle('hm-file', (req) => {
    const raw = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    if (!IMG_EXT.test(raw) || !existsSync(raw)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(raw).toString())
  })
}

const INJECT_PRELOAD = join(__dirname, '../preload/inject.js')
/** 리포 루트의 templates/ — 개발 실행 기준. 패키징하면 extraResources 로 옮겨야 한다 (HANDOVER 에 적어둠). */
const TEMPLATES_DIR = resolve(app.getAppPath(), '../templates')

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1e1e', symbolColor: '#cccccc', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      sandbox: false,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })

  /** webview 가 붙을 때 우리 오버레이 preload 를 끼운다. contextIsolation 을 끄는 이유는 inject/index.ts 머리말. */
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.preload = INJECT_PRELOAD
    prefs.contextIsolation = false
    prefs.sandbox = false
    prefs.nodeIntegration = false
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  if (process.env.HM_AUTOTEST) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[renderer:${e.level}] ${e.message}`)
    })
    win.webContents.once('did-finish-load', () => { void autotest(win!, process.env.HM_AUTOTEST!, process.env.HM_AUTOTEST_OUT || join(app.getPath('temp'), 'hm-autotest')) })
  }
}

const send = (ch: string, payload: unknown): void => { win?.webContents.send(ch, payload) }

app.whenReady().then(() => {
  serveLocalFiles()
  createWindow()
  dev.bindEmitter(send as never)

  /* ---- 프로젝트 ---- */
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch) => { const s = { ...readSettings(), ...patch }; writeSettings(s); return s })
  ipcMain.handle('project:pick', () => projects.pickDir())
  ipcMain.handle('project:open', (_e, dir: string) => projects.openDir(dir))
  ipcMain.handle('project:forget', (_e, dir: string) => forgetRecent(dir))
  ipcMain.handle('project:clone', (_e, url: string) => projects.cloneRepo(url, (s) => send('devserver:log', s)))
  ipcMain.handle('project:templates', () => (existsSync(TEMPLATES_DIR) ? readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []))
  ipcMain.handle('project:create', (_e, template: string, name: string) => projects.createFromTemplate(join(TEMPLATES_DIR, template), name, (s) => send('devserver:log', s)))
  ipcMain.handle('project:routes', (_e, dir: string) => projects.listRoutes(dir))
  ipcMain.handle('project:readFile', (_e, dir: string, rel: string) => projects.readFile(dir, rel))
  ipcMain.handle('project:writeFile', (_e, dir: string, rel: string, content: string) => projects.writeFile(dir, rel, content))
  ipcMain.handle('project:openEditor', (_e, file: string, line?: number) => projects.openInEditor(file, line))
  ipcMain.handle('project:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('project:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

  /* ---- dev 서버 ---- */
  ipcMain.handle('devserver:start', (_e, dir: string) => dev.start(dir))
  ipcMain.handle('devserver:stop', () => dev.stop())
  ipcMain.handle('devserver:state', () => dev.getState())

  /* ---- Claude ---- */
  ipcMain.handle('claude:ask', (_e, req: ClaudeRequest) => { claude.ask(req, (ev) => send('claude:event', ev)); return true })
  ipcMain.handle('claude:abort', () => claude.abort())
  ipcMain.handle('claude:running', () => claude.isRunning())
  ipcMain.handle('claude:auth', () => authInfo())
  ipcMain.handle('claude:preview', (_e, req: ClaudeRequest) => claude.buildPrompt(req))
  ipcMain.handle('images:pick', () => projects.pickImages())
  ipcMain.handle('images:stash', (_e, dir: string, files: string[]) => projects.stashImages(dir, files))
  ipcMain.handle('images:stashBytes', (_e, dir: string, bytes: Uint8Array, name: string) => projects.stashImageBytes(dir, bytes, name))

  /* ---- 소스 되찾기·적용 ---- */
  ipcMain.handle('source:locate', (_e, dir: string, className: string, text?: string) => source.locate(dir, className, text))
  ipcMain.handle('source:applyStyle', (_e, dir: string, className: string, changes: StyleChange[], text?: string) => source.applyStyle(dir, className, changes, text))
  ipcMain.handle('source:applyText', (_e, dir: string, className: string, oldText: string, newText: string) => source.applyText(dir, className, oldText, newText))
  ipcMain.handle('source:snippet', (_e, dir: string, rel: string, line: number) => source.snippet(dir, rel, line))
  ipcMain.handle('source:preview', (_e, className: string, changes: StyleChange[]) => source.rewriteClassName(className, changes))

  /* ---- git ---- */
  ipcMain.handle('git:status', (_e, dir: string) => git.status(dir))
  ipcMain.handle('git:commit', (_e, dir: string, msg: string) => git.commit(dir, msg))
  ipcMain.handle('git:push', (_e, dir: string) => git.push(dir))
  ipcMain.handle('git:pull', (_e, dir: string) => git.pull(dir))
  ipcMain.handle('git:setRemote', (_e, dir: string, url: string) => git.setRemote(dir, url))
  ipcMain.handle('git:diff', (_e, dir: string, path?: string) => git.diff(dir, path))
  ipcMain.handle('git:show', (_e, dir: string, hash: string) => git.show(dir, hash))
  ipcMain.handle('git:checkoutFile', (_e, dir: string, path: string) => git.checkoutFile(dir, path))
  ipcMain.handle('git:init', (_e, dir: string) => git.init(dir))

  /* ---- 디자인 토큰 ---- */
  ipcMain.handle('tokens:read', (_e, dir: string) => tokens.readTokens(dir))
  ipcMain.handle('tokens:write', (_e, dir: string, name: string, value: string) => tokens.writeToken(dir, name, value))

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  void dev.stop().then(() => { claude.abort(); app.quit() })
})
app.on('before-quit', () => { claude.abort() })
