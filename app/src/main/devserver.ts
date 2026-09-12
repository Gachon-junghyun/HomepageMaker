import { spawn, execFile, type ChildProcess } from 'node:child_process'
import type { DevServerState } from '../shared/types'
import { hasNodeModules } from './projects'

/**
 * 프로젝트의 `npm run dev` 한 개를 들고 있는다. 프로젝트를 바꾸면 죽이고 새로 띄운다.
 * 포트는 우리가 정하지 않는다 — Next 가 찍는 "http://localhost:NNNN" 을 읽는다 (3000 이 차 있으면 3001 로 가니까).
 */
type Emit = (ch: 'devserver:log' | 'devserver:state', payload: unknown) => void

let child: ChildProcess | null = null
let state: DevServerState = { running: false }
let emit: Emit = () => {}

export function bindEmitter(e: Emit): void {
  emit = e
}

export function getState(): DevServerState {
  return state
}

function setState(s: DevServerState): void {
  state = s
  emit('devserver:state', s)
}

function killTree(pid: number): Promise<void> {
  return new Promise((res) => {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => res())
    else {
      try { process.kill(-pid, 'SIGTERM') } catch { /* 이미 죽음 */ }
      res()
    }
  })
}

function npmInstall(dir: string): Promise<void> {
  return new Promise((res, rej) => {
    emit('devserver:log', '\n$ npm install  (node_modules 가 없어서 먼저 깐다)\n')
    const p = spawn('npm install', { cwd: dir, shell: true, windowsHide: true })
    p.stdout?.on('data', (d) => emit('devserver:log', String(d)))
    p.stderr?.on('data', (d) => emit('devserver:log', String(d)))
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error('npm install 실패 (exit ' + code + ')'))))
  })
}

export async function start(dir: string): Promise<DevServerState> {
  await stop()
  if (!hasNodeModules(dir)) {
    setState({ running: false, installing: true })
    await npmInstall(dir)
  }
  emit('devserver:log', `\n$ npm run dev   (cwd ${dir})\n`)
  const env = { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', CI: '1' }
  child = spawn('npm run dev', { cwd: dir, shell: true, windowsHide: true, env, detached: process.platform !== 'win32' })
  const pid = child.pid
  setState({ running: true, pid, installing: false })
  const onData = (d: Buffer): void => {
    const s = String(d)
    emit('devserver:log', s)
    if (!state.url) {
      const m = s.match(/https?:\/\/localhost:\d+/)
      if (m) setState({ ...state, url: m[0] })
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('exit', (code) => {
    emit('devserver:log', `\n[dev 서버 종료 exit=${code}]\n`)
    if (child?.pid === pid) {
      child = null
      setState({ running: false })
    }
  })
  return state
}

export async function stop(): Promise<void> {
  if (!child?.pid) return
  const pid = child.pid
  child = null
  await killTree(pid)
  setState({ running: false })
}
