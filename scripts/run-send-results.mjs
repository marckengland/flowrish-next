import {runInboxPerformance} from './run-inbox-performance.mjs'
runInboxPerformance({suite:'send-results'}).catch(error=>{console.error(error instanceof Error?error.message:'Send-result database drill failed.');process.exitCode=1})
