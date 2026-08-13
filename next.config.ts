import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "groq-sdk", "music-metadata"],
};

export default nextConfig;
