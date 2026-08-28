# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Axocom Backend — Codebase Architecture & Conventions

This section is the persistent reference for how *this specific repo* is written. It was built by reading every layer of `src/` directly (not from the aspirational `Readme.md`, which documents some things that don't exist yet — see "Known gaps" below). Follow this when adding or touching code so new code looks like it was written by the same person who wrote the rest.

A deeper, stack-wide version of this (covering a sister project, `un-backend`, that implements the same architecture with a few more mature patterns) lives in `docs/graphql-backend-guide.md`. Read that when you want the "how would a more advanced version of this pattern look" answer.

## 1. Request flow (top to bottom)

```
src/index.ts
  → express app: cors → rate limiter → json/urlencoded body parsing → cookieParser
  → GET /health, GET /
  → REST: app.use('/api/voters', voterRoutes)   (CSV export only — everything else is GraphQL)
  → POST /graphql: optionalAuth middleware → Apollo expressMiddleware
        context = { req, user: req.user ?? null, loaders: createLoaders() }   ← built PER REQUEST
  → connectToDatabase() (fails fast: process.exit(1) if MySQL unreachable)
  → notFoundHandler (currently registered AFTER apollo.start()/listen — see gaps)
```

- `buildGraphQL()` (`src/graphql/loaders/graphql.loader.ts`) loads every `.gql`/`.graphql` file under `src/graphql/schema/` with `loadFilesSync`, merges them with `mergeTypeDefs`, and merges every resolver module in a hardcoded array with `mergeResolvers`. **When you add a new domain, you must add both the schema file (auto-picked-up by the glob) and register its resolver object in that array** — schema files are discovered automatically, resolver modules are not.
- `createLoaders()` (`src/graphql/loaders/dataloader.ts`) is called fresh on every GraphQL request specifically so DataLoader's per-request cache never leaks data across requests/users. Never hoist a loader instance to module scope.

## 2. Layering — one direction only

```
resolver → repository → db (mysql2 pool)
resolver → model (types + table name + optional CREATE TABLE)
resolver → context (requireAuth/requireAdmin/loaders)
```

Resolvers never touch `db` directly. Repositories never import GraphQL types (`GraphQLError`, `GraphQLContext`). Models are the only place a table's shape and column list are allowed to live — don't inline column names elsewhere; import `CANDIDATE_TABLE`, `Candidate`, etc.

**Per-domain file quartet.** Every domain (`candidate`, `voter`, `election`, `party`, `constituency`, `election_candidate`, `election_result`, `mentor`, `solution`, `flag`, `auth`, `delegate_pass`, `nomination`, `refund_request`) follows the same four-file shape:
- `src/models/<domain>.model.ts` — `RowDataPacket`-extending interface + `<DOMAIN>_TABLE` const (+ sometimes a `CREATE_<DOMAIN>_TABLE` DDL string, used only by tests that spin up a real MySQL container)
- `src/repositories/<domain>.repository.ts` — a `class XRepository { ... }` exporting one singleton instance (`export const xRepository = new XRepository()`), every method returns `Promise<Result<T, RequestError>>` from `neverthrow`
- `src/graphql/resolvers/<domain>.resolver.ts` — exports `<domain>Resolvers` (Query/Mutation/field resolvers), registered in `graphql.loader.ts`
- `src/graphql/schema/<domain>.schema.gql` — SDL types/inputs/Query/Mutation extensions for that domain

When adding a new domain, copy this quartet exactly — don't invent a 5th shape.

## 3. Repository pattern — never throw, always `Result`

```typescript
class CandidateRepository {
    async getById(id: number): Promise<Result<Candidate, RequestError>> {
        try {
            const [rows] = await db.execute<Candidate[]>(`SELECT * FROM ${CANDIDATE_TABLE} WHERE id = ?`, [id]);
            if (rows.length === 0) return err(ERRORS.CANDIDATE_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error('Error fetching candidate by id:', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}
export const candidateRepository = new CandidateRepository();
```

- Always parameterized queries (`?` placeholders) — never string-interpolate user input into SQL. Table names come from the `*_TABLE` const, which is fine to interpolate since it's a compile-time constant, not user input.
- Every catch block logs via `createLogger('@<domain>.repository')` then returns `err(ERRORS.DATABASE_ERROR)` — never rethrow, never let mysql2 errors escape a repository method.
- `getAllX()` methods take no pagination today (there are commented-out cursor-pagination stubs in `candidate.repository.ts` — see `docs/graphql-backend-guide.md` for the real cursor pagination this repo should eventually adopt, already implemented in `un-backend`).
- Offset pagination helpers live in `src/utils/pagination.ts` (`clampPage`, `buildPagination`, `Paginated<T>`). The hackathon repos (`solution`, `mentor`) predate it and carry private copies — leave those alone, but import from the shared util in any new repository.

**Money.** Summit registrations store amounts as integer paise (`BIGINT`), never rupees or floats, matching Razorpay's unit. The frontend converts at the edge via `~/features/summit/lib/money`. Totals are always recomputed server-side (`unit_amount × quantity`) — a client-supplied total is never trusted. The `razorpay_order_id` / `razorpay_payment_id` columns are nullable-unique so a replayed gateway callback cannot double-record a payment.

## 4. Resolvers — auth, errors, field resolvers

```typescript
candidate: async (_: any, { id }: { id: number }, context?: GraphQLContext): Promise<Candidate | null> => {
    if (context) requireAuth(context);
    const result = await candidateRepository.getById(id);
    if (result.isErr()) {
        logger.error('Error fetching candidate:', result.error);
        throw new GraphQLError('Candidate not found', { extensions: { code: '30001' } });
    }
    return result.value;
},
```

- Auth is enforced **inside the resolver**, not in middleware — `optionalAuth` only decodes the JWT into `context.user` if present; it never rejects a request. Call `requireAuth(context)` (any logged-in user) or `requireAdmin(context)` (admin flag) from `src/graphql/context.ts` at the top of any resolver that needs it. Public queries simply skip the call.
- **Two competing error-throw styles exist in this repo — prefer the newer one for new code:**
  - Older/majority style (candidate, election, party, constituency, election_candidate, election_result, voter): construct `new GraphQLError(msg, { extensions: { code: '<5-digit string>' } })` inline in every branch.
  - Newer style (mentor, solution, flag, auth's use of `requireAuth`): call `toGraphQLError(result.error)` from `src/graphql/context.ts`, which maps a `RequestError`'s `statusCode` to the right Apollo `code` (`UNAUTHORIZED`/`FORBIDDEN`/`NOT_FOUND`/`CONFLICT`/`BAD_USER_INPUT`/`INTERNAL_SERVER_ERROR`) and carries the numeric `errorCode` through automatically.
  - **When writing new resolvers, use `toGraphQLError(result.error)` against an `ERRORS.*` entry** instead of hand-rolling a `GraphQLError`. It's less code and keeps the Apollo `code` extension consistent with the HTTP-style `statusCode` on the `RequestError`.
- Nested/relational fields are resolved through DataLoaders, never a direct repository call in a field resolver — this is what prevents N+1s:
  ```typescript
  ElectionCandidate: {
      candidate: (parent, _, context) => context.loaders.candidateLoader.load(parent.candidate_id),
      party: (parent, _, context) => context.loaders.partyLoader.load(parent.party_id),
  },
  ```
  If you add a new foreign-key relationship, add a batch function + loader to `dataloader.ts` and a field resolver — don't call `xRepository.getById()` inside a field resolver.
- Every resolver module re-declares the scalar resolvers it needs (`JSON: GraphQLJSON`, `DateTime: DateTimeResolver`) — this is safe because `mergeResolvers` de-dupes identical scalar resolver values across modules.

## 5. Auth & JWT

- Two-token scheme: `createAuthToken` (access, default 36 weeks via `JWT_EXPIRES_IN`) and `createRefreshToken` (7 days, **hardcoded**, and — unlike `un-backend` — signed with the *same* `JWT_SECRET` as the access token, not a separate `JWT_REFRESH_SECRET`. `un-backend` already fixed this; treat it as a known weakness, not something to copy into new code).
- `TokenData` payload: `{ id, is_admin, email?, name? }` (note: `un-backend`'s equivalent field is `userId`, this repo's is `id` — don't cross-copy field names between the two projects without renaming).
- Passwords: `bcrypt.hash(password, 12)` (`SALT_ROUNDS = 12` in `auth.resolver.ts`), minimum 8 characters, enforced in the `signup` resolver by hand (not schema-level).
- `optionalAuth` (GraphQL) vs `requireAuthMiddleware` (REST, used by `voter.route.ts`'s CSV export) — both live in `src/middleware/auth.middleware.ts`. REST routes that need auth use the middleware; GraphQL resolvers use `requireAuth`/`requireAdmin` from context.

## 6. Error codes — 5-digit convention

Defined once in `src/utils/error.ts` as `RequestError` instances keyed on a semantic name in the `ERRORS` object:

| Range | Domain |
|---|---|
| 1xxxx | Common/general (DB errors, validation, not-found) |
| 2xxxx | Auth & authorization |
| 3xxxx | Candidate service |
| 4xxxx | Admin service |
| 5xxxx | Voter/election/party/constituency service |
| 6xxxx | Hackathon (mentor/solution) submissions |
| 7xxxx | Summit registrations (delegate pass, nomination) |
| 8xxxx | Refund requests |

Add new errors to `ERRORS` in this file, in the right range, rather than inventing ad-hoc codes inline in a resolver. Note some duplicate numeric codes already exist in this file (e.g. `USER_NOT_FOUND` and `INVALID_OTP` both `20010`) — don't copy that mistake; grep the file for a code before reusing a number.

## 7. Config, env, and secrets

- `src/config/env.ts` is **gitignored** (see `.gitignore`) — it does not exist in a fresh clone and must be created locally (or provisioned by deploy tooling). It's imported everywhere (`import { PORT, DB_HOST, ... } from './config/env'`) as the single source of typed env vars, loaded via `dotenv`. If you're setting up the repo fresh, you need to create this file yourself from `.env.example` + a small `dotenv`-based loader — copy the shape from `un-backend/src/config/env.ts` (see `docs/graphql-backend-guide.md`).
- `.env` (actual secrets) is also gitignored; `.env.example` documents the required variable names only.

## 8. Testing conventions

- Unit/repository tests (`*.repository.test.ts`) spin up a real disposable MySQL via `testcontainers`' `GenericContainer('mysql:latest')`, `jest.mock('../dataconfig/db')` to point at it, run the domain's `CREATE_*_TABLE` DDL, and assert against `Result.isOk()/isErr()` directly — no mocking of the repository itself.
- Integration tests (`src/tests/integration/*.integration.test.ts`) spin up a full `ApolloServer` via `createTestServer()`/`createContext()` in `src/tests/setup.ts`, and mock the repository layer with `jest.spyOn(xRepository, 'method').mockResolvedValue(ok(...)/err(...))` — these test the resolver + schema wiring, not the DB.
- **Known drift**: some integration tests (e.g. `candidate.integration.test.ts`) reference fields (`neta_id`, `pan_itr`, `criminal_cases`, `assets`, `liabilities`, `details_of_*`) that no longer exist on the current `Candidate` model/schema. Don't treat those tests as the current contract — treat the `.model.ts`/`.schema.gql` files as the source of truth, and expect to fix or delete stale test fields if you touch that file.
- Coverage thresholds (per `Readme.md`): 70% branches/functions/lines/statements — check `jest.config.cjs` before assuming this is enforced in CI.

## 9. Known gaps vs. the aspirational `Readme.md`

The `Readme.md` reads like a target-state architecture doc; a few things it describes are not actually true of the code today — don't assume they exist without checking:
- `src/config/env.ts` is not in the repo (gitignored, see §7).
- Depth-limiting (`validationRules: [depthLimit(5)]`) is commented out in `index.ts`.
- Production-conditional introspection disabling is commented out in `index.ts`.
- Cursor-based pagination is commented out/stubbed in `candidate.repository.ts` only; not implemented anywhere yet.
- `notFoundHandler` is registered after `httpServer.listen(PORT)` in `index.ts`, which likely means it never actually applies before the server starts serving — worth fixing if you're in that file anyway, but don't silently "fix" it as a drive-by change; call it out.

## 10. Style conventions (mechanical)

- 4-space indent, single quotes, semicolons, trailing commas (ES5-style), 100 col print width — enforced by `.prettierrc`, not currently backed by a committed ESLint config (there's an `npm run lint` script but no `eslint.config.*` in this repo — don't assume lint is wired up).
- ES modules (`"type": "module"` in `package.json`), TypeScript compiled with `tsc`, run in dev via `tsx watch`.
- Logger: always `const logger = createLogger('@<file-ish-name>')` at module top, never `console.log` inside repositories/resolvers (middleware/error.middleware.ts is the one exception, using `console.log` directly — don't copy that into new code, use the logger).
