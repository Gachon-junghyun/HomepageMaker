/** 앱 창 ↔ 메인 ↔ webview 셋이 같이 쓰는 모양. 여기 말고 다른 데서 타입을 다시 만들지 마라. */

export interface Project {
  /** 절대경로. 프로젝트의 정체성은 이것 하나다. */
  dir: string
  name: string
  lastOpened: number
  remote?: string
}

export interface RouteInfo {
  /** "/about" */
  path: string
  /** app/about/page.tsx (프로젝트 상대) */
  file: string
}

/** webview 안에서 고른 요소 한 개의 설명. Claude 프롬프트와 디자인 패널이 둘 다 이걸 먹는다. */
export interface ElementInfo {
  hmId: string
  tag: string
  id: string
  className: string
  text: string
  /** 자기 텍스트 노드가 있는가 — 없으면 «글» 편집칸을 안 보여준다 (컨테이너의 textContent 를 통째로 고치게 두지 않는다) */
  directText: boolean
  attrs: Record<string, string>
  rect: { x: number; y: number; w: number; h: number }
  /** 겉으로 보이는 스타일 — 패널에 채우는 값 */
  computed: Record<string, string>
  /** 가까운 React 함수 컴포넌트 이름들, 안쪽→바깥쪽 */
  components: string[]
  /** 문서 루트부터의 nth-of-type 셀렉터 — id 가 날아가도 다시 찾는 열쇠 */
  cssPath: string
  /** 부모 → 이 요소까지의 짧은 경로 (빵부스러기용) */
  crumbs: { hmId: string; tag: string; label: string }[]
}

export interface TreeNode {
  hmId: string
  tag: string
  label: string
  component?: string
  children: TreeNode[]
}

/** 디자인 패널이 만드는 «한 번의 변경». 라이브 적용과 코드 적용이 같은 걸 먹는다. */
export interface StyleChange {
  /** css 프로퍼티 ('background-color' 처럼 kebab-case) */
  prop: string
  value: string
}

export interface SourceMatch {
  file: string
  line: number
  col: number
  preview: string
}

export interface ApplyResult {
  ok: boolean
  file?: string
  line?: number
  /** ok=false 일 때 이유 — 유일하지 않음·못 찾음·className 없음 */
  reason?: string
  /** 새 className 문자열(적용됐을 때) */
  className?: string
}

export interface ThemeToken {
  name: string
  value: string
  /** globals.css 안의 줄 번호 */
  line: number
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  remote: string
  ahead: number
  behind: number
  changes: { code: string; path: string }[]
  log: { hash: string; date: string; subject: string }[]
}

/** claude -p --output-format stream-json 이 뿜는 줄 하나. 필요한 필드만 뽑았다. */
export interface ClaudeEvent {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error' | 'raw' | 'done'
  subtype?: string
  session_id?: string
  text?: string
  tool?: { name: string; input: unknown }
  result?: string
  cost?: number
  duration_ms?: number
  is_error?: boolean
  raw?: string
}

export interface DevServerState {
  running: boolean
  url?: string
  pid?: number
  installing?: boolean
}

/** 낙서 한 획. 캔버스 좌표계는 «기기 폭 기준 CSS 픽셀»이다 (줌은 부모의 transform 이 한다). */
export interface Stroke {
  kind: 'stroke'
  tool: 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'text'
  color: string
  width: number
  points: { x: number; y: number }[]
  text?: string
}

/** 번호 핀 — 낙서의 핵심. 찍으면 그 자리의 «요소»를 같이 알아내서 Claude 에게 「①은 이것」으로 넘긴다. */
export interface Pin {
  kind: 'pin'
  n: number
  x: number
  y: number
  /** 사람이 핀 옆에 적은 말 */
  note: string
  /** 그 자리에 뭐가 있었나 (webview 가 알려준다) */
  target?: { tag: string; className: string; text: string; components: string[] }
}

export type SketchItem = Stroke | Pin

export interface ClaudeRequest {
  dir: string
  prompt: string
  /** 선택 요소 — 있으면 프롬프트 앞에 «맥락»으로 붙는다 */
  selection?: ElementInfo | null
  /** 현재 보고 있는 라우트와 그 page 파일 */
  route?: RouteInfo | null
  /** 첨부 이미지 절대경로들 (이미 프로젝트 안 .homepage-maker/refs 로 복사된 것) */
  images?: string[]
  /** 낙서의 번호 핀 — 첨부 그림 위의 ①②③ 가 각각 무엇인지 말로 풀어 준다 */
  pins?: Pin[]
  sessionId?: string
  allowBash?: boolean
}
