import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@voiceai/db", "@voiceai/auth", "@voiceai/shared", "@voiceai/providers"],
  serverExternalPackages: ["pg", "@node-rs/argon2"],
};

export default config;
