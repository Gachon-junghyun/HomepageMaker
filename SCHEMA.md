# SCHEMA.md — 앱의 트리 구조

> **뭐냐:** 홈페이지 제작소 앱(`app/`)의 모든 부품이 어디에 붙어 있는지 한 장. GAMEMAKER 의 `SCHEMA_TEMPLATE.md` 규칙을 그대로 따른다.
> **언제 읽나:** 뭔가 «추가»하기 전에 (어디에 붙일지) · 처음 이어받을 때.
> **안 담는 것:** 왜 그렇게 정했나(→ `HANDOVER.md`·코드 머리말) · 규칙(→ `START_HERE.md`).

표시: ✅ 실제로 띄워서 봤다 · ⚠️ 있는데 미검증 · ❌ 없다 · 🚧 짓는 중. 🔴 **코드를 고친 같은 턴에 여기도 고친다.**

```
홈페이지 제작소 (Electron · electron-vite · React 19 · Tailwind 4 · TS)
│
├─ 0. 부팅  ─ app/src/main/index.ts
│   ├─ 창 하나 (1600×1000, 숨긴 타이틀바 + 오버레이 버튼)          ✅
│   ├─ webview 붙을 때 오버레이 preload 끼움 (will-attach-webview) ✅   contextIsolation=false 인 이유는 inject 머리말
│   ├─ ipcMain.handle 한 묶음 (preload/index.ts 와 1:1)          ✅
│   ├─ 자가 검증 HM_AUTOTEST (autotest.ts)                       ✅   스크린샷 6장 + 로그 → %TEMP%\hm-autotest
│   └─ 종료: dev 서버·claude 자식 죽이기                          ✅   (강제 종료 땐 고아 남음 — HANDOVER)
│
├─ 1. 메인 프로세스 (Node 를 쥔 유일한 자리) ─ app/src/main/
│   ├─ store.ts      설정 JSON(최근 목록·sitesDir·Bash 토글)      ✅
│   ├─ projects.ts   열기·clone·템플릿 복사·라우트 목록·첨부 복사   ✅ (clone ⚠️)
│   ├─ devserver.ts  npm run dev 스폰·포트 파싱·로그 중계·kill tree ✅
│   ├─ claude.ts     프롬프트 조립 · claude -p stream-json 스폰    ⚠️  배관 확인, 편집은 로그인 뒤
│   ├─ source.ts     className → 소스 줄 되찾기 · Tailwind 재작성  ✅  단위 테스트
│   ├─ git.ts        status/commit/push/pull/diff/log/remote      ✅ 읽기 / ⚠️ 쓰기
│   └─ tokens.ts     globals.css @theme 읽기/쓰기                  ✅ 읽기 / ⚠️ 쓰기
│
├─ 2. 다리 ─ app/src/preload/index.ts → window.hm                 ✅
│
├─ 3. 오버레이 (webview 안, 사용자 홈페이지 위) ─ app/src/inject/index.ts
│   ├─ 호버 상자 + 이름표                                          ✅
│   ├─ 선택 상자 + 핸들 + 크기 배지                                 ✅
│   ├─ 박스모델 칠하기 (padding 초록 · margin 주황)                 ✅
│   ├─ Alt 거리 재기 (빨간 선)                                     ⚠️
│   ├─ 방향키 탐색 · Esc · 재클릭=부모                              ⚠️
│   ├─ React fiber → 컴포넌트 경로 / 소유자                         ✅  (RSC 는 안 잡힘)
│   ├─ describe(): 태그·class·글·computed·cssPath·crumbs           ✅
│   ├─ tree(): 레이어용 DOM 트리                                   ✅
│   ├─ HMR 뒤 cssPath 로 재선택                                    ⚠️
│   ├─ 호스트 명령: mode/select/clear/highlight/style/unstyle/text/tree/describe ✅
│   └─ at(x,y): 선택을 «안 바꾸고» 그 자리 요소만 읽어 준다 (번호 핀이 쓴다)   ✅
│
├─ 4. 껍데기 (React) ─ app/src/renderer/src/
│   ├─ store.ts      상태 하나 + wv 다리 + Claude 이벤트→채팅        ✅
│   ├─ App.tsx       시작 화면 ↔ 작업 화면 · 토스트                   ✅
│   ├─ components/
│   │   ├─ Start.tsx     최근 · 폴더 열기 · GitHub · 새 홈페이지      ✅
│   │   ├─ TopBar.tsx    페이지 ▾ · 선택도구 · 기기 4 · 줌 · dev 상태 · 열기 ✅
│   │   ├─ Canvas.tsx    webview + 기기 폭 + 줌 + 단축키(V/D/1~7/Esc) · 오버레이 되살리기 ✅
│   │   ├─ Sketch.tsx    🎨 낙서 판 (webview 위 canvas)              ✅
│   │   │   ├─ 번호 핀 ①②③ + 메모 → «그 자리의 요소»까지 붙잡음      ✅  이 기능의 본체
│   │   │   ├─ 펜 · 화살표 · 사각형 · 동그라미 · 형광펜 · 글          ✅
│   │   │   ├─ 되돌리기(Ctrl+Z) · 전부 지우기                        ✅
│   │   │   └─ 화면+낙서를 PNG 한 장으로 구워 첨부 + 핀 메모로 요청문 초안 ✅
│   │   ├─ SketchBar.tsx 도구 팔레트 (캔버스 아래 고정)              ✅
│   │   └─ LogDrawer.tsx dev 로그 서랍                              ✅
│   └─ panels/
│       ├─ LeftPanel.tsx   레이어 ✅ · 페이지 ✅ (+추가=Claude ⚠️) · 토큰 ✅
│       ├─ RightPanel.tsx  탭 넷
│       ├─ Design.tsx      글 · 글자 · 채우기 · 간격 · 배치 · 테두리 · 효과 → 라이브 ✅ · 코드에 적용 ✅ · Claude 로 넘기기 ⚠️
│       ├─ ClaudePanel.tsx 채팅 · 선택 칩 · 첨부(끌기/붙여넣기/파일) · Bash 토글 · 미리보기 · 중단   ⚠️
│       ├─ CodePanel.tsx   되찾기 결과(정확/부분/추정) · 스니펫 · VS Code   ✅
│       └─ GitPanel.tsx    브랜치 · remote · push/pull · 바뀐 파일 · diff · 커밋 · 기록   ✅ 읽기
│
├─ 5. 템플릿 ─ templates/nextjs-susanna-stack/                     ✅  복사→install→dev→렌더 확인
│   ├─ config/site.ts (회사 정보·메뉴) · app/globals.css @theme 토큰
│   ├─ app/ (홈·회사소개·문의) · components/ (Header·Footer·Section)
│   └─ wrangler.jsonc · open-next.config.ts (Cloudflare)
│
├─ 6. 데이터
│   ├─ 앱 설정: %APPDATA%\homepage-maker\settings.json (BOM 없음)   ✅
│   ├─ 리포 안 흔적: <리포>/.homepage-maker/refs/ (첨부·낙서 그림)    ✅
│   │   └─ 만들 때 .gitignore 에 «반드시» 등록 (refsDir() 한 곳)     ✅  두 경로가 이걸 공유한다
│   ├─ 로컬 그림을 화면에 보여주는 길: hm-file:// 프로토콜            ✅  file:// 는 렌더러에서 막힌다
│   └─ 사이트: sites/<이름>/ (각자 git)                             ✅
│
└─ 7. 빌드·배포
    ├─ electron-vite build → app/out/ · start.cmd                  ✅
    └─ 설치 파일(electron-builder)                                 ❌
```

## 변경 이력
- 2026-09-12 (이어서) — 낙서(Sketch·SketchBar) · at() · hm-file:// · refsDir() 추가.
- 2026-09-12 — 최초 작성. v0.1 트리.
