import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "e2e/rehearsal-app/.next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "e2e/rehearsal-app/next-env.d.ts",
      "src/generated/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Global rule tuning: unused variables prefixed with `_` are
    // intentional — commonly a signature-required arg like Next.js
    // route handler `request` params, or destructured fields we
    // keep for readability. Treat them as opted-out of the warning.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Tests rely on partial mocks where `any` is the pragmatic shape,
    // and property-based tests often declare arbitraries that only
    // become used in later assertions — so the strictness of the
    // unused-var rule is more noise than signal here.
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.property.test.ts",
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];

export default eslintConfig;
