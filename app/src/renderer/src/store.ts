import { useSyncExternalStore } from 'react'
import type { ClaudeEvent, DevServerState, ElementInfo, Pin, Project, RouteInfo, SketchItem, StyleChange, TreeNode } from '@shared/types'

/**
 * 앱 전체 상태 하나. 라이브러리 없이 useSyncExternalStore 다 — 상태 모양이 한 곳에 다 보이게.
 * 바꾸는 건 `set()` 뿐이고, webview 로 말하는 건 `wv.send()` 뿐이다.
 */
export type Device = 'mobile' | 'tablet' | 'desktop' | 'full'
export const DEVICES: Record<Device, { w: number; label: string }> = {
  mobile: { w: 390, label: '모바일 390' },
  tablet: { w: 820, label: '태블릿 820' },
  desktop: { w: 1440, label: '데스크톱 1440' },
  full: { w: 0, label: '꽉 채움' },
}

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  images?: string[]
  tool?: { name: string; detail: string }
  cost?: number
  ms?: number
  error?: boolean
}

export interface State {
  project: Project | null
  routes: RouteInfo[]
  route: string
  dev: DevServerState
  logs: string[]
  logOpen: boolean
  pageUrl: string
  selection: ElementInfo | null
  tree: TreeNode | null
  hoverId: string
  selectMode: boolean
  device: Device
  zoom: number
  leftTab: 'layers' | 'pages' | 'tokens'
  rightTab: 'design' | 'claude' | 'code' | 'git'
  live: StyleChange[]
  liveText: string | null
  chat: ChatMsg[]
  claudeRunning: boolean
  sessionId?: string
  allowBash: boolean
  pendingImages: string[]
  /** Claude 입력칸의 글. 낙서가 핀 메모로 여기에 초안을 채우므로 store 에 있다 (로컬 state 였으면 밖에서 못 채운다) */
  draft: string
  toast: { text: string; kind: 'ok' | 'err' } | null
  gitTick: number
  /* ---- 낙서 ---- */
  sketchOn: boolean
  sketchTool: SketchTool
  sketchColor: string
  sketchWidth: number
  sketch: SketchItem[]
  /** 보낸 그림에 딸린 핀 설명. 첨부가 비면 같이 비운다 */
  pins: Pin[]
}

export type SketchTool = 'pin' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'text'

let state: State = {
  project: null, routes: [], route: '/', dev: { running: false }, logs: [], logOpen: false, pageUrl: '',
  selection: null, tree: null, hoverId: '', selectMode: true, device: 'desktop', zoom: 0.75,
  leftTab: 'layers', rightTab: 'design', live: [], liveText: null,
  chat: [], claudeRunning: false, allowBash: false, pendingImages: [], draft: '', toast: null, gitTick: 0,
  sketchOn: false, sketchTool: 'pin', sketchColor: '#f24822', sketchWidth: 4, sketch: [], pins: [],
}
const subs = new Set<() => void>()
export function set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  subs.forEach((f) => f())
}
export function get(): State { return state }
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => sel(state))
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
  set({ toast: { text, kind } })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), kind === 'err' ? 6000 : 2800)
}

/* ---------- webview 다리 ---------- */
type WebviewLike = {
  send: (ch: string, ...a: unknown[]) => void
  loadURL: (u: string) => Promise<void>
  reload: () => void
  getURL: () => string
  capturePage: () => Promise<{ toDataURL: () => string }>
} | null
let webview: WebviewLike = null

/** webview 에 «그 자리에 뭐가 있나»를 묻고 기다리는 사람들. Canvas 의 ipc-message 가 깨운다. */
const atWaiters = new Map<string, (info: ElementInfo | null) => void>()
let atSeq = 0

export const wv = {
  bind(w: WebviewLike): void { webview = w },
  send(msg: Record<string, unknown>): void { try { webview?.send('hm', msg) } catch { /* 아직 안 붙음 */ } },
  go(url: string): void { void webview?.loadURL(url) },
  reload(): void { webview?.reload() },
  url(): string { try { return webview?.getURL() ?? '' } catch { return '' } },
  /** 화면을 그대로 찍는다 (낙서 합성용). webview 태그가 직접 준다 — 메인을 안 거친다. */
  async capture(): Promise<string | null> {
    try { return (await webview!.capturePage()).toDataURL() } catch { return null }
  },
  /** 선택을 «바꾸지 않고» 좌표의 요소만 읽는다. 핀이 쓴다. */
  at(x: number, y: number): Promise<ElementInfo | null> {
    return new Promise((resolve) => {
      if (!webview) return resolve(null)
      const id = 'at' + ++atSeq
      atWaiters.set(id, resolve)
      setTimeout(() => { if (atWaiters.delete(id)) resolve(null) }, 1500)
      wv.send({ type: 'at', id, x, y })
    })
  },
  resolveAt(id: string, info: ElementInfo | null): void {
    const f = atWaiters.get(id)
    if (f) { atWaiters.delete(id); f(info) }
  },
}

/* ---------- 프로젝트 열기/닫기 ---------- */
export async function openProject(p: Project): Promise<void> {
  set({ project: p, routes: [], route: '/', selection: null, tree: null, live: [], liveText: null, chat: [], sessionId: undefined, logs: [], pageUrl: '' })
  const routes = await window.hm.project.routes(p.dir)
  set({ routes })
  try { await window.hm.dev.start(p.dir) } catch (e) { toast(String(e), 'err') }
}

export async function closeProject(): Promise<void> {
  await window.hm.dev.stop()
  set({ project: null, dev: { running: false }, selection: null, tree: null, pageUrl: '' })
}

/* ---------- Claude 이벤트 → 채팅 ---------- */
let seq = 0
const mid = (): string => 'm' + (++seq)
export function pushChat(m: Omit<ChatMsg, 'id'>): void { set((s) => ({ chat: [...s.chat, { id: mid(), ...m }] })) }

export function onClaudeEvent(ev: ClaudeEvent): void {
  if (ev.session_id && !state.sessionId) set({ sessionId: ev.session_id })
  switch (ev.type) {
    case 'assistant':
      if (ev.text) pushChat({ role: 'assistant', text: ev.text })
      if (ev.tool) pushChat({ role: 'tool', text: '', tool: { name: ev.tool.name, detail: toolDetail(ev.tool.name, ev.tool.input) } })
      break
    case 'result':
      set({ claudeRunning: false, sessionId: ev.session_id ?? state.sessionId, gitTick: state.gitTick + 1 })
      if (ev.is_error) pushChat({ role: 'system', text: ev.result || '오류로 끝났다', error: true })
      else pushChat({ role: 'system', text: `끝. ${ev.duration_ms ? (ev.duration_ms / 1000).toFixed(1) + 's' : ''}${ev.cost ? ` · $${ev.cost.toFixed(3)}` : ''}`, cost: ev.cost, ms: ev.duration_ms })
      break
    case 'done':
      if (state.claudeRunning) { set({ claudeRunning: false, gitTick: state.gitTick + 1 }); if (ev.is_error) pushChat({ role: 'system', text: ev.text || 'claude 가 비정상 종료', error: true }) }
      break
    case 'error':
      set({ claudeRunning: false }); pushChat({ role: 'system', text: ev.text || '오류', error: true }); break
    case 'raw':
      if (ev.raw && /error|Error|not found|ENOENT/.test(ev.raw)) pushChat({ role: 'system', text: ev.raw.trim(), error: true })
      break
  }
}

function toolDetail(name: string, input: any): string {
  if (!input) return ''
  const rel = (p: string): string => { const d = state.project?.dir; return d && p?.startsWith(d) ? p.slice(d.length + 1) : p }
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': return rel(input.file_path ?? '')
    case 'Grep': return `"${input.pattern}"${input.path ? ' in ' + rel(input.path) : ''}`
    case 'Glob': return input.pattern ?? ''
    case 'Bash': return (input.command ?? '').slice(0, 120)
    default: return JSON.stringify(input).slice(0, 120)
  }
}

/** 요청 보내기. 선택·라우트·첨부를 같이 싣는다. */
export async function askClaude(prompt: string, opts: { includeSelection?: boolean } = {}): Promise<void> {
  const s = state
  if (!s.project) return
  const text = prompt.trim()
  if (!text) return
  const images = s.pendingImages
  pushChat({ role: 'user', text, images })
  set({ claudeRunning: true, pendingImages: [], draft: '', rightTab: 'claude' })
  const route = s.routes.find((r) => r.path === s.route) ?? null
  await window.hm.claude.ask({
    dir: s.project.dir, prompt: text,
    selection: opts.includeSelection === false ? null : s.selection,
    route, images, pins: images.length ? s.pins : [], sessionId: s.sessionId, allowBash: s.allowBash,
  })
  set({ pins: [] })
}

/** 자가 검증용 훅 — 메인이 HM_AUTOTEST 로 띄웠을 때 executeJavaScript 로 만진다. 제품 기능이 아니다. */
;(window as any).__hm = { openProject, get, set, wv, askClaude }
