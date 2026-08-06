/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Type errors fail the build. `npm run verify` runs tsc first anyway.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // The workspace store is a server-only filesystem adapter; keep it off the client bundle.
    serverSourceMaps: false,
  },
};

export default nextConfig;
