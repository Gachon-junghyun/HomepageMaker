import { spawn, type ChildProcess } from 'node:child_process'
import type { ClaudeEvent, ClaudeRequest, ElementInfo, Pin } from '../shared/types'

/**
 * Claude Code CLI 를 «프로젝트 폴더를 cwd 로» 띄운다. 프롬프트는 stdin 으로 넣는다 (argv 따옴표 지옥 회피).
 *
 * 권한: 기본은 파일 도구만(Read/Edit/Write/Grep/Glob). Bash 는 사람이 토글로 켠 턴에만.
 * cwd 밖은 못 건드린다(--add-dir 없음). 이 두 겹이 실제 방어다 — DeGaJa 헌법 P4 와 같은 생각.
 *
 * 🔴 이 앱이 Claude Code 안에서 실행됐을 때 `CLAUDECODE` 환경변수가 상속되면 CLI 가 «중첩 세션»으로 보고 거절한다.
 *    그래서 지운다.
 */
type Emit = (ev: ClaudeEvent) => void

let child: ChildProcess | null = null

const STYLE_KEYS = [
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'padding', 'margin', 'border-radius', 'border', 'gap', 'display', 'flex-direction', 'justify-content', 'align-items',
  'width', 'height', 'opacity', 'box-shadow',
]

function describeSelection(s: ElementInfo): string {
  const attrs = Object.entries(s.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')
  const open = `<${s.tag}${s.id ? ` id="${s.id}"` : ''}${s.className ? ` class="${s.className}"` : ''}${attrs}>`
  const styles = STYLE_KEYS.filter((k) => s.computed[k]).map((k) => `${k}: ${s.computed[k]}`).join('; ')
  return [
    '선택한 요소:',
    `- 여는 태그: ${open}`,
    s.text ? `- 안의 글: "${s.text}"` : '',
    s.components.length ? `- React 컴포넌트 경로(안쪽→바깥쪽): ${s.components.join(' › ')}` : '',
    `- 겉보기 스타일(computed): ${styles}`,
    `- 크기: ${Math.round(s.rect.w)}×${Math.round(s.rect.h)}px`,
    `- DOM 셀렉터: ${s.cssPath}`,
    s.className
      ? '- 찾는 법: 위 class 문자열(전체 또는 앞 몇 개)을 리포에서 Grep 하면 그 JSX 줄이 나온다. 안 잡히면 컴포넌트 이름으로 파일을 찾아라.'
      : '- 찾는 법: class 가 없다. 컴포넌트 이름과 안의 글로 파일을 찾아라.',
  ].filter(Boolean).join('\n')
}

export function buildPrompt(req: ClaudeRequest): string {
  const parts: string[] = ['[홈페이지 제작소에서 온 요청 — 이 폴더는 Next.js 홈페이지 리포다]']
  if (req.route) parts.push(`지금 보고 있는 페이지: ${req.route.path}  (파일 ${req.route.file})`)
  if (req.selection) parts.push(describeSelection(req.selection))
  if (req.others?.length) {
    parts.push(`함께 고른 것 ${req.others.length}개 (위의 «선택한 요소»가 기준이고, 아래도 같이 바꿔야 한다):`)
    for (const o of req.others) {
      parts.push(`- <${o.tag}${o.className ? ` class="${o.className}"` : ''}>` + (o.text ? ` 글: "${o.text.slice(0, 60)}"` : '') + (o.components[0] ? ` · ${o.components[0]}` : ''))
    }
  }
  if (req.images?.length) {
    parts.push('첨부 이미지(사람이 «이렇게 해달라»고 준 레퍼런스다 — 반드시 Read 도구로 열어 보고 그대로 참고하라):')
    for (const p of req.images) parts.push(`- ${p}`)
  }
  if (req.pins?.length) parts.push(describePins(req.pins))
  parts.push('', '요청:', req.prompt.trim(), '')
  parts.push(
    '규칙:',
    '- 고치는 파일은 최소로. 요청한 요소(와 그 컴포넌트) 밖으로 번지지 마라.',
    '- 색·폰트·간격은 리포에 이미 정해진 토큰(globals.css 의 @theme, config/*)을 먼저 써라. 새 값을 지어내기 전에 있는 걸 찾아라.',
    '- 되돌릴 수 없는 일(커밋·push·배포·패키지 설치)은 하지 마라 — 사람이 앱에서 누른다.',
    '- 확인 못 한 건 「확인 못 함」으로 남겨라. 그럴듯하게 채우지 마라.',
    '- 끝나면 «무엇을 · 어느 파일 · 몇 줄»을 두세 줄로 답하라. 긴 설명은 필요 없다.',
  )
  return parts.join('\n')
}

/**
 * 첨부 그림 위의 ①②③ 를 말로 푼다. 그림만 주면 「빨간 동그라미 친 그것」이 코드의 어디인지 Claude 가 다시 추측해야 한다 —
 * 핀을 찍을 때 webview 가 이미 그 자리의 요소를 알고 있으니, 추측할 일을 없앤다.
 */
function describePins(pins: Pin[]): string {
  const lines = ['첨부한 화면 그림 위의 번호 핀 (사람이 손으로 찍은 것이다 — 이 번호가 무엇을 가리키는지는 아래가 정답이다):']
  for (const p of pins) {
    const t = p.target
    const what = t
      ? `<${t.tag}${t.className ? ` class="${t.className}"` : ''}>` + (t.text ? ` 글: "${t.text}"` : '') + (t.components.length ? ` · 컴포넌트 ${t.components.join(' › ')}` : '')
      : '(그 자리에 잡히는 요소 없음 — 그림을 보고 판단하라)'
    lines.push(`- ${circled(p.n)} ${p.note ? `「${p.note}」 — ` : ''}${what}`)
  }
  return lines.join('\n')
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function circled(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`
}

export function isRunning(): boolean {
  return child !== null
}

export function abort(): void {
  if (!child?.pid) return
  const p = child
  child = null
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
  else p.kill('SIGTERM')
}

export function ask(req: ClaudeRequest, emit: Emit): void {
  if (child) abort()
  const tools = ['Read', 'Edit', 'Write', 'MultiEdit', 'Grep', 'Glob', 'LS', ...(req.allowBash ? ['Bash'] : [])]
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', tools.join(',')]
  if (req.sessionId) args.push('--resume', req.sessionId)

  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT

  const prompt = buildPrompt(req)
  emit({ type: 'raw', raw: `$ claude ${args.join(' ')}\n` })
  // 인자에 공백·특수문자가 없으니(도구 목록은 쉼표) 문자열로 붙여도 안전하다. 프롬프트는 stdin 이라 여기 안 들어간다.
  const p = spawn(['claude', ...args].join(' '), { cwd: req.dir, shell: true, windowsHide: true, env })
  child = p
  p.stdin?.end(prompt, 'utf-8')

  let buf = ''
  p.stdout?.on('data', (d) => {
    buf += String(d)
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) emit(parseLine(line))
    }
  })
  p.stderr?.on('data', (d) => emit({ type: 'raw', raw: String(d) }))
  p.on('exit', (code) => {
    if (buf.trim()) emit(parseLine(buf.trim()))
    if (child === p) child = null
    emit({ type: 'done', is_error: code !== 0, text: code ? `claude 종료 exit=${code}` : undefined })
  })
  p.on('error', (e) => emit({ type: 'error', text: String(e) }))
}

/** stream-json 한 줄 → 우리 이벤트. 모르는 모양은 raw 로 흘린다 (버리지 않는다). */
function parseLine(line: string): ClaudeEvent {
  let j: any
  try { j = JSON.parse(line) } catch { return { type: 'raw', raw: line } }
  if (j.type === 'system') return { type: 'system', subtype: j.subtype, session_id: j.session_id }
  if (j.type === 'assistant') {
    const content = j.message?.content ?? []
    const texts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const tool = content.find((c: any) => c.type === 'tool_use')
    return { type: 'assistant', session_id: j.session_id, text: texts || undefined, tool: tool ? { name: tool.name, input: tool.input } : undefined }
  }
  if (j.type === 'user') return { type: 'user', session_id: j.session_id }
  if (j.type === 'result') {
    return { type: 'result', subtype: j.subtype, session_id: j.session_id, result: j.result, cost: j.total_cost_usd, duration_ms: j.duration_ms, is_error: !!j.is_error }
  }
  return { type: 'raw', raw: line }
}
