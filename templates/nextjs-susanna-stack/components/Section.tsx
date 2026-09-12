/** 섹션 하나 = 눈썹(작은 대문자) + 제목 + 본문. 톤이 둘이다: white / paper */
export default function Section({
  eyebrow,
  title,
  tone = "white",
  children,
}: {
  eyebrow?: string;
  title: string;
  tone?: "white" | "paper";
  children: React.ReactNode;
}) {
  return (
    <section className={tone === "paper" ? "bg-paper" : "bg-white"}>
      <div className="wrap py-16 md:py-24">
        {eyebrow && <p className="text-accent font-semibold tracking-[0.2em] text-xs mb-3">{eyebrow}</p>}
        <h2 className="text-2xl md:text-4xl font-bold mb-10">{title}</h2>
        {children}
      </div>
    </section>
  );
}
