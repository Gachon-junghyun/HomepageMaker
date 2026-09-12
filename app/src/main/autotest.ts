import { BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 자가 검증. `HM_AUTOTEST=<프로젝트 폴더>` 로 띄우면 그 프로젝트를 열고, dev 서버가 뜨면 화면을 찍고,
 * 요소 하나를 클릭해 선택이 되는지까지 확인한 뒤 결과를 `HM_AUTOTEST_OUT` 폴더에 남긴다.
 * 에이전트가 GUI 를 직접 못 볼 때 «눈으로 확인한 것만 ✅» 를 지키기 위한 장치다.
 */
/**
 * 낙서 시나리오: 켜기 → 핀 두 개(요소를 실제로 물어온다) → 화살표 → 형광펜 → 첨부로 굽기.
 * 진짜 PointerEvent 를 쏜다 — React 합성 이벤트도 이걸 받는다.
 */
async function sketchRun(js: <T>(c: string) => Promise<T>, say: (s: string) => void, shot: (n: string) => Promise<void>): Promise<void> {
  const pointer = (x: number, y: number, type: string, id = 1): string =>
    `(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('${type}', { bubbles: true, clientX: r.left + ${x} * (r.width / c.clientWidth), clientY: r.top + ${y} * (r.height / c.clientHeight), pointerId: ${id}, isPrimary: true, button: 0 }));
      return 'ok' })()`
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  await js(`__hm.set({ device: 'desktop', zoom: 0.75, sketchOn: true, selectMode: false, sketchTool: 'pin' })`)
  await wait(400)
  say('낙서 켬 · canvas: ' + (await js<string>(`JSON.stringify((c => c && { w: c.clientWidth, h: c.clientHeight })(document.querySelector('canvas')))`)))

  await js(pointer(300, 120, 'pointerdown'))
  await wait(1200)
  await js(`document.querySelector('input[placeholder*="에 대해"]').value = '이 메뉴'`)
  await js(`(() => { const i = document.querySelector('input[placeholder*="에 대해"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '이 메뉴를 더 크게'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok' })()`)
  await wait(400)

  await js(pointer(500, 420, 'pointerdown', 2))
  await wait(1200)
  await js(`(() => { const i = document.querySelector('input[placeholder*="에 대해"]'); if (!i) return 'no-input'; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '여기는 지워줘'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok' })()`)
  await wait(400)
  say('핀: ' + (await js<string>(`JSON.stringify(__hm.get().sketch.filter(i => i.kind === 'pin').map(p => ({ n: p.n, note: p.note, target: p.target && (p.target.tag + '.' + p.target.className.slice(0, 40) + ' ' + p.target.components.join('>')) })))`)))

  // 화살표 하나, 형광펜 한 획
  await js(`__hm.set({ sketchTool: 'arrow', sketchColor: '#0d99ff' })`)
  await js(pointer(200, 600, 'pointerdown', 3)); await js(pointer(420, 470, 'pointermove', 3)); await js(pointer(420, 470, 'pointerup', 3))
  await js(`__hm.set({ sketchTool: 'highlight', sketchColor: '#ffcc00' })`)
  await js(pointer(120, 300, 'pointerdown', 4)); await js(pointer(300, 305, 'pointermove', 4)); await js(pointer(520, 300, 'pointermove', 4)); await js(pointer(520, 300, 'pointerup', 4))
  await wait(400)
  say('획: ' + (await js<string>(`JSON.stringify(__hm.get().sketch.map(i => i.kind === 'pin' ? 'pin' + i.n : i.tool))`)))
  await shot('07-sketch.png')

  await js(`window.__hmSketch.sketchToAttachment()`)
  await wait(2500)
  say('첨부: ' + (await js<string>(`JSON.stringify(__hm.get().pendingImages)`)))
  say('탭: ' + (await js<string>(`__hm.get().rightTab`)) + ' · img 전체: ' + (await js<string>(`JSON.stringify([...document.querySelectorAll('img')].map(x => ({ src: x.src.slice(0, 48), ok: x.complete && x.naturalWidth > 0 })))`)))
  say('툴바 자리: ' + (await js<string>(`JSON.stringify((e => e && e.getBoundingClientRect())(document.querySelector('.fixed.bottom-4')))`)))
  say('핀 설명 보관: ' + (await js<string>(`String(__hm.get().pins.length)`)))
  say('요청문 초안: ' + (await js<string>(`JSON.stringify(__hm.get().draft)`)))
  say('프롬프트 미리보기 ---\n' + (await js<string>(`(async () => { const s = __hm.get(); return await window.hm.claude.preview({ dir: s.project.dir, prompt: s.draft, selection: s.selection, route: s.routes.find(r => r.path === s.route) || null, images: s.pendingImages, pins: s.pins }) })()`)))
  await shot('08-after-send.png')
}

/**
 * 손으로 옮기고 키우기: 손잡이(se)를 끌어 크기 → 본체를 끌어 이동 → 회전 손잡이 → 방향키.
 * webview 에 «진짜» 마우스 입력을 넣는다 (합성 이벤트로는 오버레이의 pointerdown 이 안 잡힌다).
 */
async function handRun(js: <T>(c: string) => Promise<T>, say: (s: string) => void, shot: (n: string) => Promise<void>): Promise<void> {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const drag = async (x1: number, y1: number, x2: number, y2: number): Promise<void> => {
    const send = (type: string, x: number, y: number, extra = ''): string =>
      `document.querySelector('webview').sendInputEvent({ type: '${type}', x: ${Math.round(x)}, y: ${Math.round(y)}, button: 'left', clickCount: 1${extra} })`
    await js(send('mouseMove', x1, y1))
    await js(send('mouseDown', x1, y1))
    for (let i = 1; i <= 6; i++) await js(send('mouseMove', x1 + (x2 - x1) * i / 6, y1 + (y2 - y1) * i / 6, ', movementX: 1, movementY: 1'))
    await js(send('mouseUp', x2, y2))
    await wait(350)
  }
  const rectOf = async (): Promise<{ left: number; top: number; right: number; bottom: number; width: number; height: number }> =>
    JSON.parse(await js<string>(`document.querySelector('webview').executeJavaScript("JSON.stringify((e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })(document.querySelector('#__hm > .sel')))")`))

  await js(`__hm.set({ device: 'desktop', zoom: 0.75, sketchOn: false, selectMode: true, hand: true })`)
  await wait(1500)   // 기기 폭을 바꾸면 webview 가 다시 붙는다 — 그 전에 입력을 넣으면 Invalid guestInstanceId
  await js(`__hm.wv.send({ type: 'mode', on: true }); __hm.wv.send({ type: 'hand', on: true, moveMode: 'translate' })`)
  await wait(600)
  // 히어로 안의 제목 하나를 고른다
  await js(`(() => { const w = document.querySelector('webview'); w.sendInputEvent({ type: 'mouseMove', x: 420, y: 430 }); w.sendInputEvent({ type: 'mouseDown', x: 420, y: 430, button: 'left', clickCount: 1 }); w.sendInputEvent({ type: 'mouseUp', x: 420, y: 430, button: 'left', clickCount: 1 }) })()`)
  await wait(800)
  say('고른 것: ' + (await js<string>(`JSON.stringify((s => s && { tag: s.tag, cls: s.className.slice(0, 50), w: Math.round(s.rect.w), h: Math.round(s.rect.h) })(__hm.get().selection))`)))
  const r0 = await rectOf()
  say('선택 상자: ' + JSON.stringify({ w: Math.round(r0.width), h: Math.round(r0.height) }))

  // 1) se 손잡이를 오른쪽 아래로 끌어 크기 키우기
  await drag(r0.right - 2, r0.bottom - 2, r0.right + 90, r0.bottom + 50)
  say('크기 뒤 live: ' + (await js<string>(`JSON.stringify(__hm.get().live)`)))
  await shot('09-resize.png')

  // 2) 본체를 끌어 이동
  const r1 = await rectOf()
  await drag(r1.left + r1.width / 2, r1.top + r1.height / 2, r1.left + r1.width / 2 + 70, r1.top + r1.height / 2 + 40)
  say('이동 뒤 live: ' + (await js<string>(`JSON.stringify(__hm.get().live)`)))

  // 3) 회전 손잡이
  const r2 = await rectOf()
  await drag(r2.left + r2.width / 2, r2.top - 20, r2.left + r2.width / 2 + 80, r2.top + 10)
  say('회전 뒤 live: ' + (await js<string>(`JSON.stringify(__hm.get().live)`)))

  // 4) 방향키 (호스트가 보내는 nudge 로 대신 — 포커스가 webview 밖이어도 같은 경로다)
  await js(`__hm.wv.send({ type: 'nudge', dx: 10, dy: 0 })`)
  await wait(300)
  say('방향키 뒤 live: ' + (await js<string>(`JSON.stringify(__hm.get().live)`)))
  say('실제 style: ' + (await js<string>(`document.querySelector('webview').executeJavaScript("(() => { const p = document.querySelector('#__hm > .sel'); return 'sel ' + p.style.width })()")`)))
  await js(`__hm.set({ rightTab: 'design' })`)
  await wait(400)
  await shot('10-hand.png')

  // 5) 코드에 적용까지 — 실제로 파일이 바뀌는지
  // 🔴 여기는 «남의 리포»를 진짜로 고친다. 원본을 먼저 들고 있다가 확인 뒤 반드시 되돌린다.
  //    (2026-09-12: 이 되돌림이 없어서 드가자 홈페이지의 page.tsx 가 실제로 바뀌었고,
  //     그걸 `git checkout` 으로 되돌리다가 사람이 하던 작업 254줄까지 날릴 뻔했다. 되돌림은 git 이 아니라 여기서 한다.)
  const target = await js<string>(`(async () => { const s = __hm.get(); const r = await window.hm.source.locate(s.project.dir, s.selection.className, s.selection.text); return r.matches[0] ? r.matches[0].file : '' })()`)
  if (!target) { say('코드에 적용: 되찾기 실패 — 건너뛴다'); return }
  const read = (rel: string): Promise<string> => js<string>(`window.hm.project.readFile(__hm.get().project.dir, ${JSON.stringify(rel)})`)
  const before = await read(target)
  const applied = await js<string>(`(async () => { const s = __hm.get(); const r = await window.hm.source.applyStyle(s.project.dir, s.selection.className, s.live, s.selection.text); return JSON.stringify(r) })()`)
  say('코드에 적용: ' + applied)
  say('파일이 실제로 바뀌었나: ' + ((await read(target)) !== before))
  await restoreFile(js, target, before)
  const ok = (await read(target)) === before
  say('되돌렸나: ' + ok + (ok ? '' : ` 🔴 되돌리기 실패 — 손으로 확인하라: ${target}`))
}

/**
 * 다중 선택 → 맞추기 → 나누기 → 복제. PPT 의 «정렬» 메뉴가 웹에서 도는지 본다.
 * 카드 세 장이 있는 구역을 고른다 (드가자 홈의 화면 목록).
 */
async function multiRun(js: <T>(c: string) => Promise<T>, say: (s: string) => void, shot: (n: string) => Promise<void>): Promise<void> {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const click = async (x: number, y: number, shift = false): Promise<void> => {
    const mods = shift ? `, modifiers: ['shift']` : ''
    await js(`(() => { const w = document.querySelector('webview');
      w.sendInputEvent({ type: 'mouseMove', x: ${x}, y: ${y} });
      w.sendInputEvent({ type: 'mouseDown', x: ${x}, y: ${y}, button: 'left', clickCount: 1${mods} });
      w.sendInputEvent({ type: 'mouseUp', x: ${x}, y: ${y}, button: 'left', clickCount: 1${mods} }) })()`)
    await wait(450)
  }
  await js(`__hm.set({ device: 'desktop', zoom: 0.75, sketchOn: false, selectMode: true, hand: true })`)
  await wait(1500)
  await js(`__hm.wv.send({ type: 'mode', on: true }); __hm.wv.send({ type: 'hand', on: true, moveMode: 'translate' })`)
  // 히어로 안의 버튼 둘 — 위치가 뻔하고 형제라 정렬을 보기 좋다
  await js(`__hm.wv.send({ type: 'clear' })`)
  await wait(300)
  const spots: [number, number][] = JSON.parse(await js<string>(`document.querySelector('webview').executeJavaScript("JSON.stringify([...document.querySelectorAll('main a, main button')].slice(0, 3).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] }))")`))
  say('고를 자리: ' + JSON.stringify(spots))
  if (spots.length < 2) { say('🔴 고를 요소가 모자라 건너뛴다'); return }
  await click(spots[0][0], spots[0][1])
  // 🔴 합성 클릭에는 shiftKey 가 안 실린다(실제 마우스는 문제없다). 레이어 패널과 같은 경로로 «함께 고르기»를 시킨다.
  const sibs: string[] = JSON.parse(await js<string>(`(() => { const t = __hm.get().tree; const out = []; const walk = n => { out.push(n); n.children.forEach(walk) }; walk(t); const sel = __hm.get().selection; const me = out.find(n => n.hmId === sel.hmId); return JSON.stringify(out.filter(n => n.tag === (me ? me.tag : 'a') && n.hmId !== sel.hmId && !/skip|sr-only/.test(n.label)).slice(0, 2).map(n => n.hmId)) })()`))
  for (const id of sibs) { await js(`__hm.wv.send({ type: 'selectAdd', hmId: ${JSON.stringify(id)} })`); await wait(400) }
  say('선택: 주 1 + 함께 ' + (await js<string>(`String(__hm.get().others.length)`)))
  say('함께 고른 것: ' + (await js<string>(`JSON.stringify(__hm.get().others.map(o => o.tag + '.' + o.className.slice(0, 24)))`)))
  await js(`__hm.set({ rightTab: 'design' })`)
  await wait(400)
  await shot('11-multi.png')

  // 맞추기 (왼쪽) → 나누기(세로)
  await js(`__hm.wv.send({ type: 'align', how: 'left' })`)
  await wait(600)
  say('왼쪽 맞춤 뒤 pending: ' + (await js<string>(`JSON.stringify(__hm.get().pending.map(p => p.changes.map(c => c.prop + '=' + c.value).join(',')))`)))
  if (spots.length >= 3) {
    await js(`__hm.wv.send({ type: 'align', how: 'vdist' })`)
    await wait(600)
    say('세로 나누기 뒤 pending 수: ' + (await js<string>(`String(__hm.get().pending.length)`)))
  }
  await shot('12-align.png')

  // 복제
  const kids = (): Promise<string> => js<string>(`document.querySelector('webview').executeJavaScript("String(document.querySelector(${JSON.stringify('%%SEL%%')}).parentElement.children.length)")`)
  const path = await js<string>(`JSON.stringify(__hm.get().selection.cssPath)`)
  const countKids = async (): Promise<string> => js<string>(`document.querySelector('webview').executeJavaScript('String(document.querySelector(' + ${JSON.stringify(path)} + ').parentElement.children.length)')`)
  void kids
  const before = await countKids()
  await js(`__hm.wv.send({ type: 'duplicate' })`)
  await wait(900)
  const after = await countKids()
  say(`복제: 그 부모의 자식 수 ${before} → ${after}`)
  say('복제 뒤 초안: ' + (await js<string>(`JSON.stringify(__hm.get().draft.slice(0, 40))`)))
  await shot('13-duplicate.png')
}

/** 자가 검증이 고친 파일을 «원문 그대로» 되돌린다. git 을 쓰지 않는다 — 사람이 하던 다른 변경까지 날아가기 때문이다. */
async function restoreFile(js: <T>(c: string) => Promise<T>, rel: string, content: string): Promise<void> {
  await js(`window.hm.project.writeFile(__hm.get().project.dir, ${JSON.stringify(rel)}, ${JSON.stringify(content)})`)
}

export async function autotest(win: BrowserWindow, dirIn: string, out: string): Promise<void> {
  let dir = dirIn
  mkdirSync(out, { recursive: true })
  const log: string[] = []
  const say = (s: string): void => { log.push(`[${new Date().toISOString().slice(11, 19)}] ${s}`); writeFileSync(join(out, 'autotest.log'), log.join('\n'), 'utf-8') }
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>
  const shot = async (name: string): Promise<void> => {
    // 🔴 capturePage 가 «직전 프레임»을 주는 걸 실측했다 (낙서·첨부 칩이 빠진 그림이 나온다).
    //    두 번 페인트를 기다린 뒤 찍는다.
    await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))')
    const img = await win.webContents.capturePage()
    writeFileSync(join(out, name), img.toPNG())
    say('screenshot ' + name)
  }
  const waitFor = async (cond: string, ms: number): Promise<boolean> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { if (await js<boolean>(cond).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 500)) }
    return false
  }
  try {
    await new Promise((r) => setTimeout(r, 1500))
    await shot('01-start.png')
    say('인증: ' + (await js<string>(`(async () => JSON.stringify(await window.hm.claude.auth()))()`)))
    if (process.env.HM_AUTOTEST_CREATE) {
      // «새 홈페이지» 흐름: 템플릿 복사 → git init → 열기(npm install 포함)
      const p = await js<{ dir: string }>(`window.hm.project.create('nextjs-susanna-stack', ${JSON.stringify(process.env.HM_AUTOTEST_CREATE)})`)
      say('created: ' + p.dir)
      dir = p.dir
    }
    await js(`__hm.openProject({ dir: ${JSON.stringify(dir)}, name: 'autotest', lastOpened: Date.now() })`)
    say('openProject 호출')
    say('dev url: ' + (await waitFor('!!__hm.get().dev.url', 400000)) + ' → ' + (await js<string>('__hm.get().dev.url')))
    say('tree: ' + (await waitFor('!!__hm.get().tree', 90000)))
    // 🔴 오버레이가 안 붙었으면 그 뒤 «선택·손·핀»이 전부 조용히 무의미해진다. 여기서 크게 말하고 한 번 되살린다.
    const hasOverlay = async (): Promise<boolean> =>
      (await js<string>(`document.querySelector('webview').executeJavaScript("String(!!document.getElementById('__hm'))")`).catch(() => 'false')) === 'true'
    if (!(await hasOverlay())) {
      say('⚠️ 오버레이 없음 — 되살린다')
      await js(`__hm.wv.reload()`)
      await new Promise((r) => setTimeout(r, 6000))
      if (!(await hasOverlay())) say('🔴 오버레이가 끝내 안 붙었다 — 이 실행의 선택·손·핀 결과는 «무효»다 (dev 서버 고아를 의심하라)')
    }
    await new Promise((r) => setTimeout(r, 2500))
    await shot('02-loaded.png')
    // 캔버스 한가운데를 webview 안에서 클릭 → 선택
    say('viewport: ' + (await js<string>(`document.querySelector('webview').executeJavaScript("JSON.stringify({w:innerWidth,h:innerHeight,body:document.body.getBoundingClientRect().height,main:document.querySelector('main')?.getBoundingClientRect().height,hm:!!document.getElementById('__hm'),rs:document.readyState})")`)))
    say('webview rect: ' + (await js<string>(`JSON.stringify(document.querySelector('webview').getBoundingClientRect())`)))
    say('elementFromPoint: ' + (await js<string>(`document.querySelector('webview').executeJavaScript("(()=>{const e=document.elementFromPoint(400,200);return e?e.tagName+'.'+e.className:'null'})()")`)))
    await js(`(() => { const w = document.querySelector('webview'); w.sendInputEvent({ type: 'mouseMove', x: 400, y: 200 }); w.sendInputEvent({ type: 'mouseDown', x: 400, y: 200, button: 'left', clickCount: 1 }); w.sendInputEvent({ type: 'mouseUp', x: 400, y: 200, button: 'left', clickCount: 1 }) })()`)
    say('selection: ' + (await waitFor('!!__hm.get().selection', 5000)) + ' → ' + (await js<string>('JSON.stringify((s=>s&&{tag:s.tag,cls:s.className.slice(0,80),comps:s.components,text:s.text.slice(0,40)})(__hm.get().selection))')))
    await new Promise((r) => setTimeout(r, 800))
    await shot('03-selected.png')
    // 라이브 스타일 + 레이어/코드 탭
    await js(`(() => { const s = __hm.get().selection; if (s) __hm.wv.send({ type: 'style', hmId: s.hmId, prop: 'background-color', value: '#ff5900' }) })()`)
    await js(`__hm.set({ rightTab: 'code' })`)
    await new Promise((r) => setTimeout(r, 2000))
    await shot('04-code-tab.png')
    await js(`__hm.set({ rightTab: 'git', leftTab: 'tokens' })`)
    await new Promise((r) => setTimeout(r, 2000))
    await shot('05-git-tokens.png')
    await js(`__hm.set({ rightTab: 'claude', leftTab: 'layers', device: 'mobile' })`)
    await new Promise((r) => setTimeout(r, 1500))
    await shot('06-claude-mobile.png')
    if (process.env.HM_AUTOTEST_HAND) await handRun(js, say, shot)
    if (process.env.HM_AUTOTEST_MULTI) await multiRun(js, say, shot)
    if (process.env.HM_AUTOTEST_SKETCH) await sketchRun(js, say, shot)
    say('DONE')
  } catch (e) {
    say('ERROR ' + String(e))
  }
}
