import {runInboxPerformance} from './run-inbox-performance.mjs'
runInboxPerformance({suite:'compose-drafts'}).catch(error=>{console.error(error instanceof Error?error.message:'Saved draft database drill failed.');process.exitCode=1})
