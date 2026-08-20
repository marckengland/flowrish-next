// Ambient declaration so the native TypeScript preview (tsgo / typecheck:fast)
// accepts side-effect CSS imports like `import "./globals.css"`.
// The stock tsc + Next.js plugin already resolve these, so this shim only
// silences a false positive from the TS 7 preview and changes nothing at runtime.
declare module "*.css";
