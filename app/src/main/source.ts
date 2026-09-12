import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ApplyResult, SourceMatch, StyleChange } from '../shared/types'

/**
 * «화면에서 고른 요소»를 «소스의 JSX 줄»로 되찾는 방법.
 *
 * 소스맵도 바벨 플러그인도 안 쓴다 — 리포를 건드리지 않기 위해서다. 대신 Tailwind 리포는 className 문자열이
 * 거의 유일해서, 그 문자열을 그대로 grep 하면 한 줄이 나온다. 그게 안 나오는 경우(cn()·템플릿·조건부)는
 * 「못 찾음」으로 돌려주고 Claude 에게 맡긴다. 여기서 추측해서 엉뚱한 줄을 고치지 않는다.
 */

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'dist', 'public', '.open-next', '.wrangler', '.homepage-maker', 'build', 'coverage'])
const EXT = /\.(tsx|jsx|ts|js|mdx?)$/

export function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(d, e.name)) }
      else if (EXT.test(e.name)) out.push(join(d, e.name))
    }
  }
  walk(dir)
  return out
}

function readRaw(file: string): { bom: boolean; text: string } {
  const raw = readFileSync(file, 'utf-8')
  const bom = raw.charCodeAt(0) === 0xfeff
  return { bom, text: bom ? raw.slice(1) : raw }
}

function writeRaw(file: string, bom: boolean, text: string): void {
  writeFileSync(file, (bom ? '﻿' : '') + text, 'utf-8')
}

function lineOf(text: string, idx: number): number {
  return text.slice(0, idx).split('\n').length
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 1) 따옴표째 정확히 같은 문자열  2) 부분 문자열  3) 같은 줄에 클래스 토큰이 전부 있는 줄
 * 순서로 찾고, 어느 단계에서 잡혔는지 `kind` 로 알려준다. 편집은 1·2 에서만 한다.
 */
export function locate(dir: string, className: string, text?: string): { matches: SourceMatch[]; kind: 'exact' | 'substring' | 'tokens' | 'text' | 'none' } {
  const cls = className.trim().replace(/\s+/g, ' ')
  const files = listSourceFiles(dir)
  const rel = (f: string): string => relative(dir, f).split(sep).join('/')
  const hit = (f: string, t: string, i: number): SourceMatch => ({ file: rel(f), line: lineOf(t, i), col: i - t.lastIndexOf('\n', i - 1), preview: t.split('\n')[lineOf(t, i) - 1].trim().slice(0, 160) })

  if (cls) {
    const exact: SourceMatch[] = []
    const sub: SourceMatch[] = []
    for (const f of files) {
      const { text: t } = readRaw(f)
      if (!t.includes(cls)) continue
      let i = -1
      while ((i = t.indexOf(cls, i + 1)) >= 0) {
        const q = t[i - 1], qe = t[i + cls.length]
        if ((q === '"' || q === "'" || q === '`') && qe === q) exact.push(hit(f, t, i))
        else sub.push(hit(f, t, i))
      }
    }
    if (exact.length) return { matches: exact, kind: 'exact' }
    if (sub.length) return { matches: sub, kind: 'substring' }

    // 3) 토큰 산개 — 조건부 클래스(cn/clsx)일 때. 편집엔 못 쓰고 «어느 파일인가»만 알려준다.
    const tokens = cls.split(' ').filter((t) => t.length > 2)
    if (tokens.length >= 2) {
      const scored: { m: SourceMatch; n: number }[] = []
      for (const f of files) {
        const { text: t } = readRaw(f)
        const lines = t.split('\n')
        lines.forEach((ln, li) => {
          const n = tokens.filter((tk) => ln.includes(tk)).length
          if (n >= Math.max(2, Math.ceil(tokens.length * 0.6))) scored.push({ m: { file: rel(f), line: li + 1, col: 1, preview: ln.trim().slice(0, 160) }, n })
        })
      }
      if (scored.length) {
        const best = Math.max(...scored.map((s) => s.n))
        return { matches: scored.filter((s) => s.n === best).map((s) => s.m), kind: 'tokens' }
      }
    }
  }
  // className 이 없거나 못 찾음 → 글로 찾아본다
  if (text && text.length >= 4) {
    const t2 = text.trim().slice(0, 60)
    const found: SourceMatch[] = []
    for (const f of files) {
      const { text: t } = readRaw(f)
      let i = -1
      while ((i = t.indexOf(t2, i + 1)) >= 0) found.push(hit(f, t, i))
    }
    if (found.length) return { matches: found, kind: 'text' }
  }
  return { matches: [], kind: 'none' }
}

/* ---------- StyleChange → Tailwind 클래스 ---------- */

const WEIGHTS: Record<string, string> = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black' }

/** 각 프로퍼티마다 «지울 기존 클래스 패턴»과 «새 클래스». variant(md: hover:) 붙은 건 안 건드린다. */
function mapChange(c: StyleChange): { remove: RegExp; add: string } | null {
  const v = c.value.trim()
  const arb = (prefix: string): string => `${prefix}-[${v.replace(/\s+/g, '_')}]`
  switch (c.prop) {
    case 'background-color':
      return { remove: /^bg-(?!(cover|contain|no-repeat|repeat|center|top|bottom|left|right|fixed|local|scroll|clip-|origin-|gradient|linear|radial|conic|none|auto|\[url|\[image|\[length|\[position|\[size|blend-))/, add: arb('bg') }
    case 'color':
      // 색만 지운다. 크기(text-lg·text-[15px])·정렬·줄바꿈은 남긴다.
      return { remove: /^text-(?!(xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)(\/|$))(?!\[\d)(?!\[length)/, add: arb('text') }
    case 'font-size':
      return { remove: /^text-(xs|sm|base|lg|xl|\dxl|\[\d[^\]]*\]|\[length[^\]]*\])$/, add: arb('text') }
    case 'font-weight':
      return { remove: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/, add: WEIGHTS[v] ? `font-${WEIGHTS[v]}` : arb('font') }
    case 'line-height': return { remove: /^leading-/, add: arb('leading') }
    case 'letter-spacing': return { remove: /^tracking-/, add: arb('tracking') }
    case 'text-align': return { remove: /^text-(left|center|right|justify|start|end)$/, add: `text-${v}` }
    case 'padding-top': return { remove: /^pt-/, add: arb('pt') }
    case 'padding-right': return { remove: /^pr-/, add: arb('pr') }
    case 'padding-bottom': return { remove: /^pb-/, add: arb('pb') }
    case 'padding-left': return { remove: /^pl-/, add: arb('pl') }
    case 'margin-top': return { remove: /^mt-/, add: arb('mt') }
    case 'margin-right': return { remove: /^mr-/, add: arb('mr') }
    case 'margin-bottom': return { remove: /^mb-/, add: arb('mb') }
    case 'margin-left': return { remove: /^ml-/, add: arb('ml') }
    case 'border-radius': return { remove: /^rounded(-(none|xs|sm|md|lg|xl|\dxl|full|\[[^\]]*\]))?$/, add: arb('rounded') }
    case 'border-color': return { remove: /^border-(?!(\d|\[\d|solid|dashed|dotted|double|none|hidden|[trblxy]-\d|[trblxy]$))/, add: arb('border') }
    case 'border-width': return { remove: /^border(-\d+|-\[\d[^\]]*\])?$/, add: v === '1px' ? 'border' : arb('border') }
    case 'gap': return { remove: /^gap-(?![xy]-)/, add: arb('gap') }
    case 'opacity': return { remove: /^opacity-/, add: arb('opacity') }
    case 'width': return { remove: /^w-/, add: arb('w') }
    case 'height': return { remove: /^h-/, add: arb('h') }
    case 'display': {
      const map: Record<string, string> = { none: 'hidden', block: 'block', flex: 'flex', grid: 'grid', 'inline-block': 'inline-block', 'inline-flex': 'inline-flex', inline: 'inline' }
      return { remove: /^(hidden|block|flex|grid|inline-block|inline-flex|inline)$/, add: map[v] ?? v }
    }
    case 'flex-direction': return { remove: /^flex-(row|col)(-reverse)?$/, add: v === 'column' ? 'flex-col' : v === 'column-reverse' ? 'flex-col-reverse' : v === 'row-reverse' ? 'flex-row-reverse' : 'flex-row' }
    case 'justify-content': {
      const map: Record<string, string> = { 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly' }
      return { remove: /^justify-(start|center|end|between|around|evenly|normal|stretch)$/, add: `justify-${map[v] ?? v}` }
    }
    case 'align-items': {
      const map: Record<string, string> = { 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', stretch: 'stretch', baseline: 'baseline' }
      return { remove: /^items-/, add: `items-${map[v] ?? v}` }
    }
    case 'box-shadow': return { remove: /^shadow(-(none|2xs|xs|sm|md|lg|xl|2xl|inner|\[[^\]]*\]))?$/, add: v === 'none' ? 'shadow-none' : v === '' ? 'shadow' : `shadow-${v}` }
    default: return null
  }
}

/** className 문자열에 변경을 먹인다. 순수 함수 — 테스트하기 쉽게. */
export function rewriteClassName(className: string, changes: StyleChange[]): string {
  let tokens = className.split(/\s+/).filter(Boolean)
  for (const c of changes) {
    const m = mapChange(c)
    if (!m) continue
    tokens = tokens.filter((t) => t.includes(':') || !m.remove.test(t))
    tokens.push(m.add)
  }
  return tokens.join(' ')
}

/**
 * 소스에 실제로 적용. exact/substring 으로 «한 곳»만 잡힐 때만 쓴다.
 * 두 곳 이상이면 어느 쪽인지 사람이(또는 Claude 가) 정해야 한다 — 여기서 고르지 않는다.
 */
export function applyStyle(dir: string, className: string, changes: StyleChange[], text?: string): ApplyResult {
  const { matches, kind } = locate(dir, className, text)
  if (kind === 'none') return { ok: false, reason: 'className 을 소스에서 못 찾았다' }
  if (kind === 'tokens') return { ok: false, reason: `클래스가 조건부로 갈라져 있다 (${matches[0].file}:${matches[0].line}) — Claude 에게 맡겨라` }
  if (kind === 'text') return { ok: false, reason: 'className 없이 글로만 찾았다 — Claude 에게 맡겨라' }
  if (matches.length !== 1) return { ok: false, reason: `같은 className 이 ${matches.length}곳에 있다 — Claude 에게 맡겨라` }
  const m = matches[0]
  const file = join(dir, m.file)
  const { bom, text: t } = readRaw(file)
  const cls = className.trim().replace(/\s+/g, ' ')
  const next = rewriteClassName(cls, changes)
  const lines = t.split('\n')
  const ln = lines[m.line - 1]
  if (!ln.includes(cls)) return { ok: false, reason: '파일이 그새 바뀌었다 — 다시 골라라' }
  lines[m.line - 1] = ln.replace(cls, next)
  writeRaw(file, bom, lines.join('\n'))
  return { ok: true, file: m.file, line: m.line, className: next }
}

/** 글 바꾸기 — 그 파일 안에 원문이 정확히 한 번 있을 때만. */
export function applyText(dir: string, className: string, oldText: string, newText: string): ApplyResult {
  const { matches, kind } = locate(dir, className, oldText)
  if (!matches.length) return { ok: false, reason: '요소를 소스에서 못 찾았다' }
  const files = [...new Set(matches.map((m) => m.file))]
  if (files.length !== 1) return { ok: false, reason: `후보 파일이 ${files.length}개다 — Claude 에게 맡겨라` }
  const file = join(dir, files[0])
  const { bom, text: t } = readRaw(file)
  const needle = oldText.trim()
  const count = t.split(needle).length - 1
  if (count !== 1) return { ok: false, reason: count === 0 ? '원문이 소스에 그대로 없다(조합된 글일 수 있다) — Claude 에게 맡겨라' : `원문이 ${count}번 나온다 — Claude 에게 맡겨라` }
  const idx = t.indexOf(needle)
  writeRaw(file, bom, t.slice(0, idx) + newText + t.slice(idx + needle.length))
  return { ok: true, file: files[0], line: lineOf(t, idx), reason: kind }
}

export function snippet(dir: string, rel: string, line: number, around = 12): { from: number; lines: string[] } {
  const { text } = readRaw(join(dir, rel))
  const all = text.split('\n')
  const from = Math.max(1, line - around)
  return { from, lines: all.slice(from - 1, line + around) }
}

export function fileMtime(dir: string, rel: string): number {
  try { return statSync(join(dir, rel)).mtimeMs } catch { return 0 }
}
