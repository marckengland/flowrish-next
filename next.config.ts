import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/release.json', headers: [
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
    ] }];
  },
  serverExternalPackages: ['unpdf', 'mammoth'],
  outputFileTracingIncludes: {
    '/api/knowledge/extract': ['./src/server/services/knowledge-parser-worker.cjs', './node_modules/unpdf/**/*', './node_modules/mammoth/**/*'],
  },
};

export default nextConfig;
