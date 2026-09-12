import { site } from "@/config/site";

export default function Footer() {
  return (
    <footer className="mt-auto bg-ink text-white/70 text-sm">
      <div className="wrap py-12 grid gap-6 md:grid-cols-2">
        <div>
          <div className="text-white font-semibold">{site.name}</div>
          <div className="mt-2">{site.address}</div>
          <div>{site.phone} · {site.email}</div>
        </div>
        <div className="md:text-right self-end">© {new Date().getFullYear()} {site.name}</div>
      </div>
    </footer>
  );
}
