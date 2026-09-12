import { execFile } from 'node:child_process'
import type { GitStatus } from '../shared/types'

/**
 * git 은 CLI 를 그대로 부른다. 라이브러리를 안 들이는 이유: 인증(자격 증명 관리자)·SSH·프록시를 git 이 이미 다 안다.
 * 🔴 push 는 «되돌릴 수 없는 쪽»이라 이 모듈이 알아서 안 부른다. 렌더러의 버튼(=사람)만 부른다.
 */
function git(dir: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', args, { cwd: dir, maxBuffer: 1 << 24, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C.UTF-8' } }, (err, stdout, stderr) => {
      if (err) rej(new Error((stderr || stdout || String(err)).trim()))
      else res(stdout)
    })
  })
}

export async function status(dir: string): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, branch: '', remote: '', ahead: 0, behind: 0, changes: [], log: [] }
  try { await git(dir, ['rev-parse', '--is-inside-work-tree']) } catch { return empty }
  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
  const remote = (await git(dir, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
  let ahead = 0, behind = 0
  try {
    const [a, b] = (await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/)
    ahead = +a; behind = +b
  } catch { /* upstream 없음 */ }
  const porcelain = await git(dir, ['status', '--porcelain']).catch(() => '')
  const changes = porcelain.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim() || '??', path: l.slice(3).trim() }))
  const logRaw = await git(dir, ['log', '--date=short', '--format=%h%x09%ad%x09%s', '-n', '40']).catch(() => '')
  const log = logRaw.split('\n').filter(Boolean).map((l) => { const [hash, date, ...s] = l.split('\t'); return { hash, date, subject: s.join('\t') } })
  return { isRepo: true, branch, remote, ahead, behind, changes, log }
}

export async function commit(dir: string, message: string): Promise<string> {
  await git(dir, ['add', '-A'])
  return git(dir, ['commit', '-m', message])
}

export function push(dir: string): Promise<string> {
  return git(dir, ['push', '-u', 'origin', 'HEAD'])
}

export function pull(dir: string): Promise<string> {
  return git(dir, ['pull', '--rebase', '--autostash'])
}

export function setRemote(dir: string, url: string): Promise<string> {
  return git(dir, ['remote', 'get-url', 'origin']).then(() => git(dir, ['remote', 'set-url', 'origin', url]), () => git(dir, ['remote', 'add', 'origin', url]))
}

export function diff(dir: string, path?: string): Promise<string> {
  return git(dir, path ? ['diff', '--', path] : ['diff', '--stat'])
}

export function show(dir: string, hash: string): Promise<string> {
  return git(dir, ['show', '--stat', '--format=%H%n%an %ad%n%n%B', hash])
}

export function checkoutFile(dir: string, path: string): Promise<string> {
  return git(dir, ['checkout', '--', path])
}

export function init(dir: string): Promise<string> {
  return git(dir, ['init'])
}
