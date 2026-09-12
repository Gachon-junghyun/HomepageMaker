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
    if (process.env.HM_AUTOTEST_SKETCH) await sketchRun(js, say, shot)
    say('DONE')
  } catch (e) {
    say('ERROR ' + String(e))
  }
}
