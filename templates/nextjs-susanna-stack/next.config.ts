import type { NextConfig } from "next";

/** 수산나 리포와 같은 축. Cloudflare 배포는 open-next.config.ts + wrangler.jsonc 가 담당한다. */
const nextConfig: NextConfig = {
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
