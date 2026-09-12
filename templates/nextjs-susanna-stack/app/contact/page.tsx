import type { Metadata } from "next";
import Section from "@/components/Section";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "문의" };

export default function Contact() {
  return (
    <Section eyebrow="CONTACT" title="문의">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3 text-ink-700">
          <div><span className="text-ink-500 text-sm">전화</span><br /><a className="text-xl font-semibold text-brand" href={`tel:${site.phone}`}>{site.phone}</a></div>
          <div><span className="text-ink-500 text-sm">이메일</span><br /><a className="font-medium" href={`mailto:${site.email}`}>{site.email}</a></div>
          <div><span className="text-ink-500 text-sm">주소</span><br />{site.address}</div>
          <div><span className="text-ink-500 text-sm">영업시간</span><br />{site.hours}</div>
        </div>
        <div className="rounded-2xl border border-line p-6 bg-paper text-sm text-ink-500">
          문의 폼은 아직 없다. 접수·알림(Supabase/메일)은 수산나 리포의 QuoteForm 과 lib/notify.ts 를 참고해 붙인다.
        </div>
      </div>
    </Section>
  );
}
