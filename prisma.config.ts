import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 6 stops auto-loading `.env` once a config file exists, so we load it
// here. `override: true` makes the project's `.env` win over any stray
// DATABASE_URL already present in the shell/parent-process environment
// (otherwise dotenv leaves the pre-existing value untouched and Prisma falls
// back to it). In production there is no `.env` file, so this is a no-op there.
config({ override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
    directUrl: env("DIRECT_URL"),
  },
});
