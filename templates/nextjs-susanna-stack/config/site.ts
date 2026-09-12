/** 회사 정보와 메뉴. 홈페이지 전체가 여기 값을 읽는다 — 문구를 고칠 땐 컴포넌트가 아니라 여기다. */
export const site = {
  name: "회사 이름",
  tagline: "한 줄로 무엇을 하는 회사인지",
  phone: "010-0000-0000",
  email: "hello@example.com",
  address: "대전광역시 ○○구 ○○로 00",
  hours: "평일 09:00 ~ 18:00 · 주말·공휴일 휴무",
  nav: [
    { href: "/about", label: "회사소개" },
    { href: "/contact", label: "문의" },
  ],
} as const;
