import type { NextConfig } from "next";

// Static export: `npm run build` writes a plain website to /out
// that any static host (Netlify, Vercel, GitHub Pages) can serve.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
