import type { ReactNode } from 'react'

/** 작은 부품들. 피그마 패널의 «행 하나 = 라벨 + 값» 리듬을 그대로. */

export function Btn({ children, onClick, kind = 'ghost', disabled, title, className = '' }: {
  children: ReactNode; onClick?: () => void; kind?: 'ghost' | 'primary' | 'danger' | 'solid'; disabled?: boolean; title?: string; className?: string
}): ReactNode {
  const base = 'no-drag inline-flex items-center gap-1 rounded px-2 h-7 text-[12px] leading-none select-none disabled:opacity-40 disabled:cursor-default cursor-pointer'
  const k = {
    ghost: 'hover:bg-white/10 text-fg',
    solid: 'bg-panel-2 border border-line hover:border-muted text-fg',
    primary: 'bg-accent hover:bg-accent-2 text-white font-medium',
    danger: 'bg-err/80 hover:bg-err text-white',
  }[kind]
  return <button type="button" className={`${base} ${k} ${className}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>
}

export function IconBtn({ children, onClick, active, title, disabled }: { children: ReactNode; onClick?: () => void; active?: boolean; title?: string; disabled?: boolean }): ReactNode {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className={`no-drag h-7 w-7 inline-flex items-center justify-center rounded cursor-pointer disabled:opacity-40 ${active ? 'bg-accent text-white' : 'hover:bg-white/10 text-fg'}`}>
      {children}
    </button>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold text-fg">{title}</div>
        {right}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2 min-h-6">
      <div className="text-muted text-[11px] truncate" title={label}>{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">{children}</div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }): ReactNode {
  return (
    <div className="flex border-b border-line h-9 shrink-0">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)}
          className={`px-3 text-[12px] cursor-pointer border-b-2 -mb-px ${value === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-muted hover:text-fg'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className="p-4 text-muted text-[12px] leading-relaxed">{children}</div>
}

/** rgb(…) / rgba(…) → #rrggbb. 못 읽으면 그대로. */
export function toHex(c: string): string {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return c.startsWith('#') ? c : '#000000'
  return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('')
}
export function isTransparent(c: string): boolean {
  return /rgba\(\d+,\s*\d+,\s*\d+,\s*0\)/.test(c) || c === 'transparent'
}
export const num = (v: string): number => Math.round(parseFloat(v) || 0)

/** 로컬 절대경로 → 앱이 읽을 수 있는 주소. `file://` 은 렌더러에서 막히므로 전용 스킴을 쓴다. */
export function fileUrl(p: string): string {
  return 'hm-file://local/' + encodeURIComponent(p.split('\\').join('/'))
}
