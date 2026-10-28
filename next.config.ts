import type { NextConfig } from 'next';

// The city is a fully client-side page, so it ships as a static export in `out/`.
// Cloudflare, the Docker image, and any static host serve those files directly.
const config: NextConfig = { output: 'export', reactStrictMode: true, devIndicators: false };
export default config;
