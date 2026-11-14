import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "heic-convert", "heic-decode", "libheif-js"],
};

export default nextConfig;
