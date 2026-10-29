import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // googleapis und pg sind reine Server-Abhängigkeiten
  serverExternalPackages: ["googleapis", "pg"],
  images: { formats: ["image/avif", "image/webp"] },
};

export default nextConfig;
