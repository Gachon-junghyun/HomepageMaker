import { dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, cpSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs'
import { basename, join, relative, sep, extname } from 'node:path'
import type { Project, RouteInfo } from '../shared/types'
import { readSettings, touchRecent } from './store'

const run = promisify(execFile)

/** 폴더 하나를 프로젝트로 등록한다. package.json 이 없으면 거절 — "홈페이지 리포"만 받는다. */
export function openDir(dir: string): Project {
  if (!existsSync(join(dir, 'package.json'))) throw new Error('package.json 이 없다 — Next.js 홈페이지 리포가 아니다: ' + dir)
  const p: Project = { dir, name: basename(dir), lastOpened: Date.now() }
  touchRecent(p)
  return p
}

export async function pickDir(): Promise<Project | null> {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return openDir(r.filePaths[0])
}

export async function pickImages(): Promise<string[]> {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  })
  return r.canceled ? [] : r.filePaths
}

/**
 * GitHub URL 을 sites/ 아래로 clone 한다. 인증은 git 이 알아서(자격 증명 관리자) — 여기서 토큰을 받지 않는다.
 * 이미 있으면 clone 을 건너뛰고 그냥 연다.
 */
export async function cloneRepo(url: string, onLog: (s: string) => void): Promise<Project> {
  const sitesDir = readSettings().sitesDir
  mkdirSync(sitesDir, { recursive: true })
  const name = url.replace(/\/+$/, '').split('/').pop()!.replace(/\.git$/, '')
  const dir = join(sitesDir, name)
  if (!existsSync(dir)) {
    onLog(`git clone ${url} → ${dir}\n`)
    const { stdout, stderr } = await run('git', ['clone', '--progress', url, dir], { maxBuffer: 1 << 24 })
    onLog(stdout + stderr)
  } else {
    onLog(`이미 있다 — 그대로 연다: ${dir}\n`)
  }
  const p = openDir(dir)
  p.remote = url
  touchRecent(p)
  return p
}

/** templates/<name> 을 복사해 새 홈페이지를 만든다. git init 까지. */
export async function createFromTemplate(templateDir: string, name: string, onLog: (s: string) => void): Promise<Project> {
  const sitesDir = readSettings().sitesDir
  mkdirSync(sitesDir, { recursive: true })
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '-')
  const dir = join(sitesDir, safe)
  if (existsSync(dir)) throw new Error('이미 같은 이름의 폴더가 있다: ' + dir)
  cpSync(templateDir, dir, { recursive: true, filter: (src) => !/node_modules|\.next$|\.git$/.test(src) })
  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8').replace(/^﻿/, ''))
  pkg.name = safe.toLowerCase()
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  onLog(`템플릿 복사 → ${dir}\n`)
  await run('git', ['init'], { cwd: dir })
  await run('git', ['add', '-A'], { cwd: dir })
  await run('git', ['-c', 'user.name=homepage-maker', '-c', 'user.email=homepage-maker@local', 'commit', '-m', 'chore: 템플릿에서 시작'], { cwd: dir })
  onLog('git init + 첫 커밋\n')
  return openDir(dir)
}

/**
 * Next.js App Router 의 라우트 목록. app/**\/page.tsx 를 훑는다.
 * (group) 폴더는 경로에서 빠지고, [slug] 는 그대로 보여준다 — 값을 지어내지 않는다.
 */
export function listRoutes(dir: string): RouteInfo[] {
  const appDir = ['app', 'src/app'].map((d) => join(dir, d)).find((d) => existsSync(d))
  if (!appDir) return []
  const out: RouteInfo[] = []
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name)
      if (ent.isDirectory()) {
        if (ent.name.startsWith('_') || ent.name === 'api') continue
        walk(full)
      } else if (/^page\.(tsx|jsx|ts|js|mdx?)$/.test(ent.name)) {
        const rel = relative(appDir, d).split(sep).filter((s) => s && !/^\(.*\)$/.test(s))
        out.push({ path: '/' + rel.join('/'), file: relative(dir, full).split(sep).join('/') })
      }
    }
  }
  walk(appDir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function readFile(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), 'utf-8').replace(/^﻿/, '')
}

export function writeFile(dir: string, rel: string, content: string): void {
  writeFileSync(join(dir, rel), content, 'utf-8')
}

export function hasNodeModules(dir: string): boolean {
  return existsSync(join(dir, 'node_modules')) && statSync(join(dir, 'node_modules')).isDirectory()
}

export function openInEditor(file: string, line?: number): void {
  // VS Code 가 있으면 줄까지, 없으면 OS 기본으로.
  execFile('code', ['-g', line ? `${file}:${line}` : file], { shell: true }, (err) => {
    if (err) void shell.openPath(file)
  })
}

/**
 * 첨부 그림이 사는 자리. `<리포>/.homepage-maker/refs/`.
 * 🔴 여기를 만들 때 «반드시» .gitignore 에 등록한다 — 안 하면 남의 홈페이지 리포에 레퍼런스 그림이 커밋된다.
 *    (2026-09-12 실측: 낙서 경로에 이 처리가 빠져 있어 6장 2.3MB 가 추적되지 않은 채 status 에 떴다.)
 */
function refsDir(dir: string): string {
  const refs = join(dir, '.homepage-maker', 'refs')
  mkdirSync(refs, { recursive: true })
  const gi = join(dir, '.gitignore')
  const cur = existsSync(gi) ? readFileSync(gi, 'utf-8') : ''
  if (!/^\.homepage-maker\/?\s*$/m.test(cur)) {
    const pad = !cur || cur.endsWith('\n') ? '' : '\n'
    appendFileSync(gi, pad + '\n# 홈페이지 제작소가 쓰는 자리 (첨부·낙서 그림)\n.homepage-maker/\n')
  }
  return refs
}

/** 파일에서 고른 그림을 리포 안으로 복사한다. Claude 가 cwd 밖을 못 읽으므로 «안으로» 들여야 한다. */
export function stashImages(dir: string, files: string[]): string[] {
  const refs = refsDir(dir)
  return files.map((f) => {
    const dest = join(refs, `${Date.now()}-${basename(f, extname(f)).replace(/[^\w-]/g, '_')}${extname(f)}`)
    copyFileSync(f, dest)
    return dest
  })
}

/** 낙서·붙여넣기처럼 «바이트로 들어온» 그림. 같은 자리에 같은 규칙으로 둔다. */
export function stashImageBytes(dir: string, bytes: Uint8Array, name = 'paste.png'): string {
  const dest = join(refsDir(dir), `${Date.now()}-${name}`)
  writeFileSync(dest, bytes)
  return dest
}
