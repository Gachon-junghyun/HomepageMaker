# 새 홈페이지 (템플릿에서 시작)

홈페이지 제작소가 `templates/nextjs-susanna-stack` 을 복사해 만든 리포다. 기술 축은 수산나디자인 홈페이지와 같다:
Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript · Cloudflare Workers(OpenNext).

- 회사 정보·메뉴 → `config/site.ts`
- 브랜드 색·글꼴 → `app/globals.css` 의 `@theme`
- 페이지 → `app/<경로>/page.tsx`
- 배포 → GitHub 에 push 하고 Cloudflare Workers Builds 를 리포에 연결하면 push 가 곧 배포다. (`npm run cf:deploy` 로 손 배포도 된다)
