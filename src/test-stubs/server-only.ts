// Empty stub for the `server-only` marker package under Vitest.
// `server-only` only exists in Next's build graph (it throws if imported
// into a client bundle). Vitest runs modules directly, so we alias the
// import to this no-op so server modules can be unit-tested.
export {}
