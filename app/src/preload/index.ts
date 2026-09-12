import { contextBridge, ipcRenderer } from 'electron'
import type { ClaudeEvent, ClaudeRequest, DevServerState, Project, RouteInfo, StyleChange } from '../shared/types'

/**
 * 앱 창(React) 이 쓰는 API 는 `window.hm` 하나다. 메인의 ipcMain.handle 이름과 1:1 이다 — 여기 없는 채널은 없다.
 */
const inv = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args) as Promise<T>
const on = <T>(ch: string, cb: (p: T) => void): (() => void) => {
  const h = (_: unknown, p: T): void => cb(p)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const api = {
  settings: { get: () => inv<any>('settings:get'), set: (patch: any) => inv<any>('settings:set', patch) },
  project: {
    pick: () => inv<Project | null>('project:pick'),
    open: (dir: string) => inv<Project>('project:open', dir),
    forget: (dir: string) => inv<Project[]>('project:forget', dir),
    clone: (url: string) => inv<Project>('project:clone', url),
    templates: () => inv<string[]>('project:templates'),
    create: (template: string, name: string) => inv<Project>('project:create', template, name),
    routes: (dir: string) => inv<RouteInfo[]>('project:routes', dir),
    readFile: (dir: string, rel: string) => inv<string>('project:readFile', dir, rel),
    writeFile: (dir: string, rel: string, content: string) => inv<void>('project:writeFile', dir, rel, content),
    openEditor: (file: string, line?: number) => inv<void>('project:openEditor', file, line),
    openExternal: (url: string) => inv<void>('project:openExternal', url),
    showInFolder: (p: string) => inv<void>('project:showInFolder', p),
  },
  dev: {
    start: (dir: string) => inv<DevServerState>('devserver:start', dir),
    stop: () => inv<void>('devserver:stop'),
    state: () => inv<DevServerState>('devserver:state'),
    onLog: (cb: (s: string) => void) => on<string>('devserver:log', cb),
    onState: (cb: (s: DevServerState) => void) => on<DevServerState>('devserver:state', cb),
  },
  claude: {
    ask: (req: ClaudeRequest) => inv<boolean>('claude:ask', req),
    abort: () => inv<void>('claude:abort'),
    running: () => inv<boolean>('claude:running'),
    preview: (req: ClaudeRequest) => inv<string>('claude:preview', req),
    onEvent: (cb: (e: ClaudeEvent) => void) => on<ClaudeEvent>('claude:event', cb),
  },
  images: {
    pick: () => inv<string[]>('images:pick'),
    stash: (dir: string, files: string[]) => inv<string[]>('images:stash', dir, files),
    stashBytes: (dir: string, bytes: Uint8Array, name: string) => inv<string>('images:stashBytes', dir, bytes, name),
  },
  source: {
    locate: (dir: string, className: string, text?: string) => inv<any>('source:locate', dir, className, text),
    applyStyle: (dir: string, className: string, changes: StyleChange[], text?: string) => inv<any>('source:applyStyle', dir, className, changes, text),
    applyText: (dir: string, className: string, oldText: string, newText: string) => inv<any>('source:applyText', dir, className, oldText, newText),
    snippet: (dir: string, rel: string, line: number) => inv<{ from: number; lines: string[] }>('source:snippet', dir, rel, line),
    preview: (className: string, changes: StyleChange[]) => inv<string>('source:preview', className, changes),
  },
  git: {
    status: (dir: string) => inv<any>('git:status', dir),
    commit: (dir: string, msg: string) => inv<string>('git:commit', dir, msg),
    push: (dir: string) => inv<string>('git:push', dir),
    pull: (dir: string) => inv<string>('git:pull', dir),
    setRemote: (dir: string, url: string) => inv<string>('git:setRemote', dir, url),
    diff: (dir: string, path?: string) => inv<string>('git:diff', dir, path),
    show: (dir: string, hash: string) => inv<string>('git:show', dir, hash),
    checkoutFile: (dir: string, path: string) => inv<string>('git:checkoutFile', dir, path),
    init: (dir: string) => inv<string>('git:init', dir),
  },
  tokens: {
    read: (dir: string) => inv<any>('tokens:read', dir),
    write: (dir: string, name: string, value: string) => inv<any>('tokens:write', dir, name, value),
  },
}

export type HmApi = typeof api
contextBridge.exposeInMainWorld('hm', api)
