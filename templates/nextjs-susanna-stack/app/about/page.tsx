import type { Metadata } from "next";
import Section from "@/components/Section";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "회사소개" };

export default function About() {
  return (
    <Section eyebrow="ABOUT" title={`${site.name} 소개`}>
      <div className="max-w-2xl text-ink-700 leading-relaxed">
        <p>언제부터, 어디서, 무엇을 해 온 회사인지 씁니다.</p>
        <p className="mt-4">주소: {site.address}</p>
      </div>
    </Section>
  );
}
