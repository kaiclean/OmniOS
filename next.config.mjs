/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Type errors fail the build. `npm run verify` also runs tsc first, so a
    // type error surfaces before the slowest step rather than inside it.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
