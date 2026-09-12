import { useState } from 'react'
import {
  AlignLeft, AlignCenter, AlignRight, AlignJustify, RotateCcw, Sparkles, Check, Move, Hand, Copy,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react'
import type { StyleChange } from '@shared/types'
import { askClaude, get, mergeLive, set, setHand, toast, useStore, wv } from '../store'
import { Btn, Empty, IconBtn, Row, Section, isTransparent, num, toHex } from '../ui'

/**
 * 디자인 패널 — 피그마의 오른쪽 «Design» 탭. 값을 만지면 webview 에 «즉시» 먹고(인라인 style), 「코드에 적용」을 눌러야 소스가 바뀐다.
 * 소스에서 유일하게 못 찾으면 안 고친다 — 대신 같은 변경을 Claude 에게 문장으로 넘긴다.
 */
export default function Design(): React.ReactNode {
  const sel = useStore((s) => s.selection)
  const live = useStore((s) => s.live)
  const liveText = useStore((s) => s.liveText)
  const project = useStore((s) => s.project)!
  const [busy, setBusy] = useState(false)
  // 🔴 훅은 전부 early return «위»에 둔다 — 아래로 내리면 선택이 없을 때 훅 수가 달라져 React #310 으로 화면이 통째로 죽는다 (2026-09-12 실측)
  const hand = useStore((s) => s.hand)
  const moveMode = useStore((s) => s.moveMode)
  const others = useStore((s) => s.others)
  const pending = useStore((s) => s.pending)

  if (!sel) return <Empty>캔버스에서 요소를 클릭하면 여기에 속성이 뜬다.<br /><br />· 클릭 = 선택, 같은 곳 재클릭 = 부모<br />· 끌면 이동 · 모서리는 크기 · 위 동그라미는 회전<br />· ←↑→↓ 1px, Shift 10px · Alt+←↑→↓ 는 트리 이동<br />· Alt 누른 채 호버 = 거리 재기<br />· V 선택 · H 손 · D 낙서</Empty>

  const val = (prop: string): string => live.find((c) => c.prop === prop)?.value ?? sel.computed[prop] ?? ''
  const change = (prop: string, value: string): void => {
    wv.send({ type: 'style', hmId: sel.hmId, prop, value })
    set((s) => ({ live: [...s.live.filter((c) => c.prop !== prop), { prop, value }] }))
  }
  const px = (prop: string, v: number): void => change(prop, `${v}px`)
  const dirty = live.length > 0 || (liveText !== null && liveText !== sel.text)

  const revert = (): void => { wv.send({ type: 'unstyle', hmId: sel.hmId }); if (liveText !== null) wv.send({ type: 'text', hmId: sel.hmId, text: sel.text }); set({ live: [], liveText: null }); wv.send({ type: 'describe', hmId: sel.hmId }) }

  const describeForClaude = (changes: StyleChange[]): string => {
    const lines = changes.map((c) => `- ${c.prop}: ${c.value}`)
    if (liveText !== null && liveText !== sel.text) lines.push(`- 글을 "${sel.text}" 에서 "${liveText}" 로`)
    return `선택한 요소의 스타일을 아래처럼 바꿔라. Tailwind 클래스로 바꾸되 리포에 이미 토큰(@theme)이 있으면 그 이름을 써라. 다른 요소는 건드리지 마라.\n${lines.join('\n')}`
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const results: string[] = []
      let failed = ''
      if (live.length) {
        const r = await window.hm.source.applyStyle(project.dir, sel.className, live, sel.text)
        if (r.ok) results.push(`${r.file}:${r.line}`); else failed = r.reason
      }
      if (!failed && liveText !== null && liveText !== sel.text) {
        const r = await window.hm.source.applyText(project.dir, sel.className, sel.text, liveText)
        if (r.ok) results.push(`${r.file}:${r.line} (글)`); else failed = r.reason
      }
      // 함께 고른 것들 — 각각 시도한다. 형제끼리 className 이 같으면 «유일하지 않다»로 거절되는 게 정상이다
      let skipped = 0
      for (const p of pending) {
        const r = await window.hm.source.applyStyle(project.dir, p.info.className, p.changes, p.info.text)
        if (r.ok) results.push(`${r.file}:${r.line}`)
        else skipped++
      }
      if (failed) {
        toast(failed, 'err')
        return
      }
      if (skipped) {
        wv.send({ type: 'unstyle', hmId: sel.hmId })
        set((s2) => ({ live: [], liveText: null, pending: [], gitTick: s2.gitTick + 1 }))
        toast(`${results.length}곳 적용 · ${skipped}개는 소스에서 «유일하지 않아» 못 했다 — 「Claude」 로 넘겨라`, 'err')
        return
      }
      wv.send({ type: 'unstyle', hmId: sel.hmId })
      set((s) => ({ live: [], liveText: null, pending: [], gitTick: s.gitTick + 1 }))
      toast('코드에 적용: ' + results.join(', '))
    } finally { setBusy(false) }
  }

  const toClaude = (): void => {
    const changes = get().live
    wv.send({ type: 'unstyle', hmId: sel.hmId })
    void askClaude(describeForClaude(changes))
    set({ live: [], liveText: null })
  }

  /** 손으로 만든 값은 live 에만 있다(인라인 style 로 화면엔 이미 먹었다). 없으면 0. */
  const liveNum = (prop: string): number => Math.round(parseFloat(live.find((c) => c.prop === prop)?.value ?? '0') || 0)
  const setXform = (prop: string, value: string): void => {
    mergeLive([{ prop, value }])
    // 숫자로 고쳐도 화면이 같이 움직여야 한다 — translate/rotate 는 한 속성에 같이 들어간다
    const tx = prop === 'translate-x' ? parseFloat(value) || 0 : liveNum('translate-x')
    const ty = prop === 'translate-y' ? parseFloat(value) || 0 : liveNum('translate-y')
    const rot = prop === 'rotate' ? parseFloat(value) || 0 : liveNum('rotate')
    if (prop.startsWith('translate') || prop === 'rotate') {
      const parts = [tx || ty ? `translate(${tx}px, ${ty}px)` : '', rot ? `rotate(${rot}deg)` : ''].filter(Boolean)
      wv.send({ type: 'style', hmId: sel.hmId, prop: 'transform', value: parts.join(' ') || 'none' })
    } else {
      wv.send({ type: 'style', hmId: sel.hmId, prop, value })
    }
  }

  const bg = val('background-color')
  const weight = val('font-weight')
  const align = val('text-align')
  const hasOwnText = sel.directText && !['img', 'svg', 'input', 'video'].includes(sel.tag)

  return (
    <div className="flex flex-col min-h-full">
      {/* 머리: 무엇을 골랐나 */}
      <div className="px-3 py-2 border-b border-line">
        <div className="flex items-center gap-1 flex-wrap text-[11px]">
          {sel.crumbs.slice(0, -1).map((c) => (
            <button key={c.hmId} type="button" className="text-muted hover:text-fg cursor-pointer" onClick={() => wv.send({ type: 'select', hmId: c.hmId })}>{c.tag} ›</button>
          ))}
          <span className="font-semibold text-fg">{sel.tag}{sel.id ? '#' + sel.id : ''}</span>
        </div>
        {sel.components.length > 0 && <div className="mt-1 text-[11px] text-accent truncate" title={sel.components.join(' › ')}>{sel.components.join(' › ')}</div>}
        <div className="mt-1 text-[10px] text-muted font-mono truncate" title={sel.className}>{sel.className || '(class 없음)'}</div>
        <div className="mt-1 text-[10px] text-muted">{Math.round(sel.rect.w)} × {Math.round(sel.rect.h)} px</div>
      </div>

      {others.length > 0 && (
        <Section title={`함께 고른 것 ${others.length + 1}개`} right={
          <button type="button" className="text-[10px] text-muted hover:text-fg cursor-pointer" onClick={() => wv.send({ type: 'select', hmId: sel.hmId })}>하나만 남기기</button>
        }>
          <div className="text-[10px] text-muted leading-relaxed">
            Shift+클릭으로 더 고른다. <b>기준은 마지막에 고른 것</b>(파란 실선) — 나머지가 거기에 맞춰진다.
          </div>
          <Row label="맞추기">
            {([['left', <AlignStartVertical size={13} />], ['hcenter', <AlignCenterVertical size={13} />], ['right', <AlignEndVertical size={13} />],
               ['top', <AlignStartHorizontal size={13} />], ['vcenter', <AlignCenterHorizontal size={13} />], ['bottom', <AlignEndHorizontal size={13} />]] as const).map(([how, ic]) => (
              <IconBtn key={how} title={{ left: '왼쪽', hcenter: '가운데(가로)', right: '오른쪽', top: '위', vcenter: '가운데(세로)', bottom: '아래' }[how]}
                onClick={() => wv.send({ type: 'align', how })}>{ic}</IconBtn>
            ))}
          </Row>
          <Row label="나누기">
            <IconBtn title="가로 간격 고르게 (3개 이상)" disabled={others.length < 2} onClick={() => wv.send({ type: 'align', how: 'hdist' })}><AlignHorizontalSpaceAround size={13} /></IconBtn>
            <IconBtn title="세로 간격 고르게 (3개 이상)" disabled={others.length < 2} onClick={() => wv.send({ type: 'align', how: 'vdist' })}><AlignVerticalSpaceAround size={13} /></IconBtn>
            <span className="text-[10px] text-muted ml-1">양 끝은 그대로, 사이를 고르게</span>
          </Row>
          <div className="text-[10px] text-warn leading-relaxed">
            🔴 맞추기는 <b>눈으로</b> 맞춘다(각자 translate). 제대로는 <b>부모를 flex 로</b> 바꾸는 거고 그건 「Claude」 버튼이 한다.
          </div>
        </Section>
      )}

      {hasOwnText && (
        <Section title="글">
          <textarea className="w-full min-h-[52px] px-2 py-1 text-[12px] resize-y" value={liveText ?? sel.text}
            onChange={(e) => { set({ liveText: e.target.value }); wv.send({ type: 'text', hmId: sel.hmId, text: e.target.value }) }} />
        </Section>
      )}

      <Section title="글자">
        <Row label="크기">
          <input type="number" className="w-16 h-6 px-1" value={num(val('font-size'))} onChange={(e) => px('font-size', +e.target.value)} />
          <select className="h-6 px-1 flex-1" value={/^\d+$/.test(weight) ? weight : '400'} onChange={(e) => change('font-weight', e.target.value)}>
            {[['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extrabold'], ['900', 'Black']].map(([v, l]) => <option key={v} value={v}>{l} {v}</option>)}
          </select>
        </Row>
        <Row label="색">
          <input type="color" value={toHex(val('color'))} onChange={(e) => change('color', e.target.value)} />
          <input className="w-20 h-6 px-1 font-mono text-[11px]" value={toHex(val('color'))} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && change('color', e.target.value)} />
        </Row>
        <Row label="줄간격">
          <input type="number" className="w-16 h-6 px-1" value={num(val('line-height'))} onChange={(e) => px('line-height', +e.target.value)} />
          <span className="text-muted text-[10px]">자간</span>
          <input type="number" step="0.5" className="w-14 h-6 px-1" value={parseFloat(val('letter-spacing')) || 0} onChange={(e) => px('letter-spacing', +e.target.value)} />
        </Row>
        <Row label="정렬">
          {([['left', <AlignLeft size={13} />], ['center', <AlignCenter size={13} />], ['right', <AlignRight size={13} />], ['justify', <AlignJustify size={13} />]] as const).map(([a, ic]) => (
            <IconBtn key={a} active={align === a || (a === 'left' && align === 'start')} onClick={() => change('text-align', a)}>{ic}</IconBtn>
          ))}
        </Row>
        <Row label="글꼴"><span className="text-[10px] text-muted truncate" title={val('font-family')}>{val('font-family').split(',')[0].replace(/"/g, '')}</span></Row>
      </Section>

      <Section title="채우기">
        <Row label="배경">
          <input type="color" value={isTransparent(bg) ? '#ffffff' : toHex(bg)} onChange={(e) => change('background-color', e.target.value)} />
          <input className="w-20 h-6 px-1 font-mono text-[11px]" value={isTransparent(bg) ? '' : toHex(bg)} placeholder="없음" onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && change('background-color', e.target.value)} />
          <Btn onClick={() => change('background-color', 'transparent')} title="배경 없애기">없음</Btn>
        </Row>
      </Section>

      <Section title="간격">
        <Row label="안쪽">{(['top', 'right', 'bottom', 'left'] as const).map((d) => <input key={d} type="number" title={'padding-' + d} className="w-12 h-6 px-1" value={num(val('padding-' + d))} onChange={(e) => px('padding-' + d, +e.target.value)} />)}</Row>
        <Row label="바깥">{(['top', 'right', 'bottom', 'left'] as const).map((d) => <input key={d} type="number" title={'margin-' + d} className="w-12 h-6 px-1" value={num(val('margin-' + d))} onChange={(e) => px('margin-' + d, +e.target.value)} />)}</Row>
        <div className="text-[10px] text-muted">순서: 위 · 오른쪽 · 아래 · 왼쪽 — 초록(안쪽)·주황(바깥)이 캔버스에 칠해진다</div>
      </Section>

      <Section title="손으로" right={
        <button type="button" title="손잡이 보이기/숨기기 (H)" onClick={() => setHand({ hand: !hand })}
          className={`no-drag h-6 px-1.5 rounded text-[10px] inline-flex items-center gap-1 cursor-pointer ${hand ? 'bg-accent text-white' : 'bg-panel-2 border border-line text-muted'}`}>
          <Hand size={11} /> {hand ? '켜짐' : '꺼짐'}
        </button>
      }>
        <div className="text-[10px] text-muted leading-relaxed">
          모서리를 끌면 크기, 안쪽을 끌면 이동, 위 동그라미는 회전. 방향키 1px · Shift 10px ·
          Shift+모서리 비율 유지 · Alt 는 격자·붙임 해제.
        </div>
        <Row label="이동 방식">
          <select className="h-6 px-1 flex-1 text-[11px]" value={moveMode} onChange={(e) => setHand({ moveMode: e.target.value as 'translate' | 'margin' })}>
            <option value="translate">띄워 옮기기 (흐름 유지 · 겹칠 수 있음)</option>
            <option value="margin">밀어 옮기기 (여백 — 주변이 밀림)</option>
          </select>
        </Row>
        <Row label="위치">
          <span className="text-muted text-[10px]">X</span>
          <input type="number" className="w-14 h-6 px-1" value={moveMode === 'margin' ? num(val('margin-left')) : liveNum('translate-x')}
            onChange={(e) => setXform(moveMode === 'margin' ? 'margin-left' : 'translate-x', `${e.target.value}px`)} />
          <span className="text-muted text-[10px]">Y</span>
          <input type="number" className="w-14 h-6 px-1" value={moveMode === 'margin' ? num(val('margin-top')) : liveNum('translate-y')}
            onChange={(e) => setXform(moveMode === 'margin' ? 'margin-top' : 'translate-y', `${e.target.value}px`)} />
        </Row>
        <Row label="회전">
          <input type="number" step={1} className="w-14 h-6 px-1" value={liveNum('rotate')} onChange={(e) => setXform('rotate', `${e.target.value}deg`)} />
          <span className="text-muted text-[10px]">도</span>
          <Btn onClick={() => { setXform('translate-x', '0px'); setXform('translate-y', '0px'); setXform('rotate', '0deg') }} title="위치·회전만 되돌리기"><Move size={12} /> 제자리로</Btn>
        </Row>
        <Row label="복제">
          <Btn kind="solid" onClick={() => wv.send({ type: 'duplicate' })} title="Ctrl+D — 화면에 하나 더. 🔴 코드엔 «아직» 없다: Claude 에게 보내야 파일에 들어간다">
            <Copy size={12} /> 복제 (Ctrl+D)
          </Btn>
          <span className="text-[10px] text-warn">화면만 — 코드는 Claude</span>
        </Row>
      </Section>

      <Section title="배치">
        <Row label="표시">
          <select className="h-6 px-1 flex-1" value={val('display')} onChange={(e) => change('display', e.target.value)}>
            {['block', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline', 'none'].map((d) => <option key={d}>{d}</option>)}
          </select>
        </Row>
        {/flex/.test(val('display')) && (
          <>
            <Row label="방향">
              <select className="h-6 px-1 flex-1" value={val('flex-direction')} onChange={(e) => change('flex-direction', e.target.value)}>{['row', 'column', 'row-reverse', 'column-reverse'].map((d) => <option key={d}>{d}</option>)}</select>
            </Row>
            <Row label="주축">
              <select className="h-6 px-1 flex-1" value={val('justify-content')} onChange={(e) => change('justify-content', e.target.value)}>{['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map((d) => <option key={d}>{d}</option>)}</select>
            </Row>
            <Row label="교차축">
              <select className="h-6 px-1 flex-1" value={val('align-items')} onChange={(e) => change('align-items', e.target.value)}>{['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'].map((d) => <option key={d}>{d}</option>)}</select>
            </Row>
          </>
        )}
        {/flex|grid/.test(val('display')) && <Row label="사이"><input type="number" className="w-16 h-6 px-1" value={num(val('gap'))} onChange={(e) => px('gap', +e.target.value)} /></Row>}
        <Row label="크기">
          <span className="text-muted text-[10px]">W</span><input type="number" className="w-16 h-6 px-1" value={num(val('width'))} onChange={(e) => px('width', +e.target.value)} />
          <span className="text-muted text-[10px]">H</span><input type="number" className="w-16 h-6 px-1" value={num(val('height'))} onChange={(e) => px('height', +e.target.value)} />
        </Row>
      </Section>

      <Section title="테두리">
        <Row label="둥글기"><input type="number" className="w-16 h-6 px-1" value={num(val('border-radius'))} onChange={(e) => px('border-radius', +e.target.value)} /></Row>
        <Row label="선">
          <input type="number" className="w-12 h-6 px-1" value={num(val('border-width'))} onChange={(e) => { px('border-width', +e.target.value); if (+e.target.value > 0 && val('border-style') === 'none') change('border-style', 'solid') }} />
          <input type="color" value={toHex(val('border-color'))} onChange={(e) => change('border-color', e.target.value)} />
        </Row>
      </Section>

      <Section title="효과">
        <Row label="투명도">
          <input type="range" min={0} max={100} className="flex-1" value={Math.round((parseFloat(val('opacity')) || 1) * 100)} onChange={(e) => change('opacity', String(+e.target.value / 100))} />
          <span className="text-[10px] w-8 text-right">{Math.round((parseFloat(val('opacity')) || 1) * 100)}%</span>
        </Row>
        <Row label="그림자">
          <select className="h-6 px-1 flex-1" value={live.find((c) => c.prop === 'box-shadow')?.value ?? (val('box-shadow') === 'none' ? 'none' : '')} onChange={(e) => change('box-shadow', e.target.value)}>
            <option value="none">없음</option><option value="sm">sm</option><option value="">기본</option><option value="md">md</option><option value="lg">lg</option><option value="xl">xl</option><option value="2xl">2xl</option>
          </select>
        </Row>
      </Section>

      {/* 아래 고정: 적용 */}
      <div className="mt-auto sticky bottom-0 bg-panel border-t border-line p-2 flex gap-1.5 items-center">
        <Btn onClick={revert} disabled={!dirty} title="라이브 변경 되돌리기"><RotateCcw size={13} /></Btn>
        <Btn kind="primary" onClick={() => void apply()} disabled={!dirty || busy} className="flex-1 justify-center"><Check size={13} /> 코드에 적용</Btn>
        <Btn kind="solid" onClick={toClaude} disabled={!dirty} title="같은 변경을 Claude 에게 문장으로 넘긴다 — 조건부 클래스라 자동 적용이 안 될 때"><Sparkles size={13} /> Claude</Btn>
      </div>
    </div>
  )
}
