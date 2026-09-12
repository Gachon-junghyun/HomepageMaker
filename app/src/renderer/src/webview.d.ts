import 'react'

/** <webview> 태그를 JSX 가 알게 한다. 속성 타입은 느슨하게 — 쓰는 건 src·style·ref 뿐이다. */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; allowpopups?: string; partition?: string }
    }
  }
}
