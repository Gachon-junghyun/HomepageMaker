import Link from "next/link";
import Section from "@/components/Section";
import { site } from "@/config/site";

export default function Home() {
  return (
    <>
      {/* 히어로 */}
      <section className="bg-ink text-white">
        <div className="wrap py-28 md:py-40 grid gap-8 md:grid-cols-[1fr_360px] md:items-end">
          <div>
            <p className="text-accent font-semibold tracking-[0.2em] text-sm mb-4">WELCOME</p>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight">
              {site.name}
              <br />
              {site.tagline}
            </h1>
            <p className="mt-6 text-lg text-white/70 max-w-xl">
              여기에 두세 줄로 회사를 소개합니다. 무엇을, 누구에게, 어떻게 다르게 하는지.
            </p>
            <div className="mt-10 flex gap-3">
              <Link href="/contact" className="inline-flex items-center rounded-full bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-600">
                문의하기
              </Link>
              <Link href="/about" className="inline-flex items-center rounded-full border border-white/30 px-6 py-3 font-semibold hover:bg-white/10">
                회사소개
              </Link>
            </div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-sm text-white/80">
            <div className="font-semibold text-white mb-2">빠른 상담</div>
            <div>{site.phone}</div>
            <div className="mt-1">{site.hours}</div>
          </div>
        </div>
      </section>

      <Section eyebrow="WHAT WE DO" title="하는 일">
        <div className="grid gap-6 md:grid-cols-3">
          {["첫 번째 서비스", "두 번째 서비스", "세 번째 서비스"].map((t) => (
            <div key={t} className="rounded-2xl border border-line p-6 hover:shadow-lg transition-shadow">
              <div className="h-10 w-10 rounded-lg bg-brand-100 mb-4" />
              <h3 className="font-semibold text-lg">{t}</h3>
              <p className="mt-2 text-ink-500 text-sm leading-relaxed">서비스 설명 두 줄. 손님이 얻는 것을 씁니다.</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="WHY US" title="왜 우리인가" tone="paper">
        <ul className="grid gap-4 md:grid-cols-2">
          {["강점 하나", "강점 둘", "강점 셋", "강점 넷"].map((t) => (
            <li key={t} className="flex gap-3 rounded-xl bg-white p-5 border border-line">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div>
                <div className="font-semibold">{t}</div>
                <div className="text-sm text-ink-500 mt-1">근거 한 줄.</div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <section className="bg-brand text-white">
        <div className="wrap py-16 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">지금 문의하세요</h2>
            <p className="mt-2 text-white/80">{site.hours}</p>
          </div>
          <a href={`tel:${site.phone}`} className="rounded-full bg-white text-brand-700 px-8 py-3 font-bold">{site.phone}</a>
        </div>
      </section>
    </>
  );
}
