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
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Tests rely on partial mocks where `any` is the pragmatic shape.
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.property.test.ts",
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
