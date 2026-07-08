---
inclusion: auto
---

# Tech Stack & Dependency Version Requirements

When installing or referencing any dependency for this project, always use the latest stable versions listed below. Do not use outdated or pinned-to-old versions.

## Runtime & Language

| Technology   | Version       | Notes                                                    |
|-------------|---------------|----------------------------------------------------------|
| Node.js     | 24.x LTS      | Current LTS line (24.13.1+). Do NOT use Node 20 or 22.  |
| TypeScript  | ~5.7.x        | Stable release. TS 6.0 is RC/beta — avoid until GA.     |
| PostgreSQL  | 18.x          | Latest stable (18.3+).                                   |
| Redis       | 8.x           | Latest stable (8.6+).                                    |

## Backend Dependencies

| Package          | Version   | Install Command                          |
|-----------------|-----------|------------------------------------------|
| fastify          | ^5.x      | `npm install fastify`                    |
| @fastify/cors    | latest    | `npm install @fastify/cors`              |
| @fastify/jwt     | latest    | `npm install @fastify/jwt`               |
| @fastify/multipart | latest | `npm install @fastify/multipart`         |
| prisma           | ^7.x      | `npm install prisma --save-dev`          |
| @prisma/client   | ^7.x      | `npm install @prisma/client`             |
| bullmq           | ^5.71+    | `npm install bullmq`                     |
| passport         | ^0.7.x    | `npm install passport`                   |
| passport-google-oauth20 | latest | `npm install passport-google-oauth20` |
| nodemailer       | ^6.x      | `npm install nodemailer`                 |
| ioredis          | latest    | `npm install ioredis`                    |
| @aws-sdk/client-s3 | latest  | `npm install @aws-sdk/client-s3`         |

## Frontend Dependencies

| Package              | Version   | Install Command                              |
|---------------------|-----------|----------------------------------------------|
| react                | ^19.2.x   | `npm install react react-dom`                |
| @tanstack/react-query | ^5.x    | `npm install @tanstack/react-query`          |
| tailwindcss          | ^4.2.x    | `npm install tailwindcss`                    |
| shadcn/ui            | latest    | `npx shadcn@latest init`                     |
| react-router         | latest    | `npm install react-router`                   |

## Testing Dependencies

| Package        | Version   | Install Command                        |
|---------------|-----------|----------------------------------------|
| vitest         | ^3.x      | `npm install vitest --save-dev`        |
| fast-check     | ^3.x      | `npm install fast-check --save-dev`    |
| @testing-library/react | latest | `npm install @testing-library/react --save-dev` |
| supertest      | latest    | `npm install supertest --save-dev`     |

## Rules

- When running `npm install`, always install without pinning to old versions unless there is a known compatibility issue.
- If a dependency has a newer major version available than listed here, prefer the version listed here for stability. Only upgrade majors after verifying compatibility.
- When generating `package.json` files, use caret (`^`) ranges to allow patch/minor updates.
- Always run `npm audit` after installing dependencies and address any high/critical vulnerabilities.
- Use `--save-exact` only for tools where exact version reproducibility is critical (e.g., prisma CLI).
