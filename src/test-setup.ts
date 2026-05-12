import '@testing-library/jest-dom'

// Tell React 18/19 that this environment supports `act(...)` so
// `createRoot` renders inside tests don't emit noisy warnings.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true
