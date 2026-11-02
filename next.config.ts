import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf', 'mammoth'],
  outputFileTracingIncludes: {
    '/api/knowledge/extract': ['./src/server/services/knowledge-parser-worker.cjs', './node_modules/unpdf/**/*', './node_modules/mammoth/**/*'],
  },
};

export default nextConfig;
