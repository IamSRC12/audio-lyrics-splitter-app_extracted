import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "groq-sdk", "music-metadata"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
