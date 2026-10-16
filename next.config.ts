import type { NextConfig } from "next";

// Static export for free static hosting (GitHub Pages). PDF content-type is native there.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
