"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { site } from "@/config/site";

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-line">
      <div className="wrap h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">{site.name}</Link>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          {site.nav.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? "text-brand" : "text-ink-700 hover:text-brand"}>{n.label}</Link>
          ))}
          <a href={`tel:${site.phone}`} className="rounded-full bg-brand px-4 py-2 text-white">{site.phone}</a>
        </nav>
        <button type="button" className="md:hidden p-2" aria-label="메뉴" onClick={() => setOpen(!open)}>
          <span className="block w-5 h-0.5 bg-ink mb-1" /><span className="block w-5 h-0.5 bg-ink mb-1" /><span className="block w-5 h-0.5 bg-ink" />
        </button>
      </div>
      {open && (
        <nav className="md:hidden border-t border-line bg-white">
          {site.nav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block px-6 py-3 border-b border-line">{n.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
