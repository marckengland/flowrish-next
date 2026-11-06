# Synthetic inbox performance

The inbox now checks callback eligibility in SQL and hydrates tasks only for the returned page and retained drafts. The page query allows PostgreSQL to push predicates into its eligible relation. This removes task payload growth with inbox size. No schema, index, dependency, or client-state change is required.

## Reproduce

Use Node 22, a local Docker Unix socket, and an already cached `postgres:17` image. Run:

```sh
npm run test:inbox:performance
```

The command strips inherited datasource and provider credentials, copies the Prisma schema to a temporary directory, generates SQL offline, and applies it only inside its labelled disposable container. The database has dummy credentials, one loopback-only published port, and no host mounts. The Node subprocess blocks private environment-file reads and non-fixture sockets. The runner verifies container identity before SQL and cleanup. Reports and query plans go under a unique `test-results/inbox-performance/<run-id>/` directory; previous reports are retained. Do not substitute a production datasource or use the checkout’s Prisma configuration for setup.

The pass seeds separate 1,000- and 10,000-follow-up workspaces with mixed statuses, individual leads/tasks, private snoozes, and an inaccessible background population. It warms each operation once and records five samples. The table shows local service-wall-time medians, not production network latency or an SLA. Each before/after run used a fresh disposable database with the same fixture shape; generated identifiers differ. Timing variance is expected.

## Results

| Follow-ups | Operation | Before median | After median | Task records hydrated before → after |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | counts | 6.32 ms | 6.35 ms | 0 → 0 |
| 1,000 | counts literal search | 6.95 ms | 6.95 ms | 0 → 0 |
| 1,000 | Pending page 1 | 20.90 ms | 14.43 ms | 1,800 → 18 |
| 1,000 | Pending literal search | 15.33 ms | 10.32 ms | 1,800 → 0 |
| 1,000 | Approved overdue shortcut | 16.60 ms | 14.17 ms | 1,000 → 100 |
| 1,000 | Pending Load more with retained draft | 18.29 ms | 13.12 ms | 1,800 → 19 |
| 1,000 | Approved deadline order | 18.58 ms | 16.49 ms | 1,000 → 100 |
| 10,000 | counts | 27.76 ms | 32.01 ms | 0 → 0 |
| 10,000 | counts literal search | 36.47 ms | 41.82 ms | 0 → 0 |
| 10,000 | Pending page 1 | 80.41 ms | 18.95 ms | 18,000 → 18 |
| 10,000 | Pending literal search | 77.29 ms | 28.90 ms | 18,000 → 0 |
| 10,000 | Approved overdue shortcut | 53.32 ms | 13.87 ms | 9,100 → 100 |
| 10,000 | Pending Load more with retained draft | 77.94 ms | 16.30 ms | 18,000 → 19 |
| 10,000 | Approved deadline order | 63.14 ms | 51.13 ms | 9,100 → 100 |

At 10,000 follow-ups, the Pending page median fell from 80.41 to 18.95 ms, Load more with a retained draft from 77.94 to 16.30 ms, and the overdue shortcut from 53.32 to 13.87 ms. A 100-row Pending page hydrated 18 task records instead of 18,000. Search returned the same ten literal matches.

Counts were not changed. Their timing differences reflect separate runs. Deadline ordering still fingerprints the entire authorized matching set and checks it again before returning; this preserves the existing continuation guard. The normal page query uses `NOT MATERIALIZED` so the planner can push page predicates into a side-effect-free CTE instead of building its entire eligible set first. See [PostgreSQL CTE materialization](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION) and [EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html).

## Correctness and safety

- The regression gate limits task hydration to 200 records for a page plus up to 100 retained rows. It does not use a timing threshold that could fail on a slower host.
- Counts exclude inaccessible leads and other owners. Literal search, overdue filters, ordinary and deadline continuation, and a retained draft outside the filter keep their assertions.
- Callback tests cover 100-item batches, duplicate source protection, reassignment, unchanged reviewed content, hidden leads, and a task-owner race between candidate hydration and canonical locks.
- Browser scenarios cover both dataset sizes, a 100-card initial window, 200 cards after Load more, exact mounted drafts, uncertain approvals, guarded overdue navigation, and desktop/mobile layouts. All prior browser scenarios remain included.
- Fresh membership, lead/task authorization, source checks, lock order, retained-ID validation, page/access versions, and deadline fingerprints remain in place.

## Limits and rollback

This is a local synthetic pass. It does not benchmark cold caches, production network latency, real mobile hardware, or rendering all 10,000 cards at once. Browser scenarios inspect the first two windows. No live AI, email, or authenticated production workflow is exercised. Production data, widget configuration, and dependencies are unchanged.

Rollback is a normal code revert. There are no persistent schema or data changes to undo.
