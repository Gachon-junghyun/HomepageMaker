import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemeToken } from '../shared/types'

/**
 * Tailwind 4 의 `@theme { --color-brand: #00a79d; }` 를 읽고 쓴다.
 * 파서를 안 만든다 — 줄 단위 정규식이다. 한 줄에 변수 하나라는 Tailwind 관례를 그대로 믿는다.
 * (여러 줄에 걸친 값 — font-family 폴백 목록 — 은 첫 줄만 보이고, 편집은 막는다.)
 */
const CANDIDATES = ['app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'app/global.css']

export function findGlobalsCss(dir: string): string | null {
  return CANDIDATES.find((c) => existsSync(join(dir, c))) ?? null
}

export function readTokens(dir: string): { file: string | null; tokens: ThemeToken[] } {
  const file = findGlobalsCss(dir)
  if (!file) return { file: null, tokens: [] }
  const text = readFileSync(join(dir, file), 'utf-8').replace(/^﻿/, '')
  const lines = text.split('\n')
  const tokens: ThemeToken[] = []
  let inTheme = false, depth = 0
  lines.forEach((ln, i) => {
    if (/^\s*@theme\b/.test(ln)) { inTheme = true; depth = 0 }
    if (inTheme) {
      depth += (ln.match(/{/g) ?? []).length - (ln.match(/}/g) ?? []).length
      const m = ln.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/)
      if (m) tokens.push({ name: m[1], value: m[2].trim(), line: i + 1 })
      if (depth <= 0 && /}/.test(ln)) inTheme = false
    }
  })
  return { file, tokens }
}

export function writeToken(dir: string, name: string, value: string): ThemeToken[] {
  const file = findGlobalsCss(dir)
  if (!file) throw new Error('globals.css 가 없다')
  const raw = readFileSync(join(dir, file), 'utf-8')
  const bom = raw.charCodeAt(0) === 0xfeff
  const lines = (bom ? raw.slice(1) : raw).split('\n')
  const re = new RegExp(`^(\\s*${name.replace(/[-]/g, '\\-')}\\s*:\\s*)([^;]+)(;.*)$`)
  let done = false
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (m) { lines[i] = m[1] + value + m[3]; done = true; break }
  }
  if (!done) throw new Error('토큰을 못 찾았다: ' + name)
  writeFileSync(join(dir, file), (bom ? '﻿' : '') + lines.join('\n'), 'utf-8')
  return readTokens(dir).tokens
}
