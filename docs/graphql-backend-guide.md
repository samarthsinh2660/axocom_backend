# GraphQL Backend Guide — Node/TS/Apollo/MySQL Stack

This is a from-first-principles guide to the architecture pattern shared by two real codebases:

- **`axocom_backend`** (this repo) — electoral analytics API.
- **`un-backend`** (`../../hills/uttrakhand-next/un-backend` relative to this repo's sibling `Work` directory) — a news/article CMS backend for a separate project.

Both were built by the same team on the same stack (Apollo Server 5 + Express 5 + TypeScript + MySQL via `mysql2` + `neverthrow` + DataLoader + JWT), and `un-backend` is, in places, a **more evolved version of the same pattern** — it fixed a few rough edges that still exist in `axocom_backend`. This doc exists so that whichever repo you're working in, you write code the way this team actually writes it, not a generic Apollo tutorial's version of it.

For `axocom_backend`-specific facts (exact file list, exact error codes already taken, known drift from its README), see `CLAUDE.md` in this repo's root. This doc is the stack-level pattern; `CLAUDE.md` is the repo-level instance of it.

---

## 1. The layering rule

```
Client
  │  GraphQL query/mutation over HTTP POST /graphql
  ▼
Express (cors → rate-limit → body-parsers → cookie-parser → [helmet])
  │
  ▼
optionalAuth middleware  — decodes JWT if present, never rejects
  │
  ▼
Apollo Server (expressMiddleware)
  │  context built fresh per request: { req, user, loaders }
  ▼
Resolvers (Query / Mutation / <Type> field resolvers)
  │  - enforce auth here (requireAuth/requireAdmin), not in middleware
  │  - throw GraphQLError via toGraphQLError(RequestError), not raw driver errors
  │  - relational fields resolved via context.loaders, never a direct repo call
  ▼
Repositories (one class per domain, singleton instance exported)
  │  - every method: Promise<Result<T, RequestError>>  (neverthrow)
  │  - parameterized SQL only, try/catch every query, never throw
  ▼
Models (RowDataPacket-typed interfaces + TABLE name constants)
  │
  ▼
mysql2/promise connection pool (src/dataconfig/db.ts or src/database/db.ts)
  │
  ▼
MySQL
```

**The rule that matters most:** each arrow only points one way. A resolver may import a repository; a repository must never import anything from `graphql/` (no `GraphQLError`, no `GraphQLContext`). A repository may import a model; a model never imports a repository. If you find yourself importing "downward-to-upward," you're breaking the layering and it will show up as a circular import or an untestable resolver.

## 2. Bootstrap (`index.ts` / `app.ts`)

Both repos wire the server the same way:

```typescript
const { typeDefs, resolvers } = buildGraphQL();     // load + merge schema/resolvers
const app = express();
const httpServer = http.createServer(app);          // needed so Apollo can drain it on shutdown

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(limiter);                                    // express-rate-limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
// un-backend adds: app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))

app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});
await apollo.start();

app.use('/graphql', express.json(), optionalAuth, expressMiddleware(apollo, {
    context: async ({ req }) => ({ req, user: req.user ?? null, loaders: createLoaders() }),
}));

// any REST-only routes (file export, upload) mount alongside /graphql
app.use('/api/voters', voterRoutes);       // axocom
app.use('/api/upload', uploadRouter);      // un-backend

await connectToDatabase();
httpServer.listen(PORT);
```

**Checklist for a new project on this stack, in order that matters:**
1. `apollo.start()` must be awaited **before** `expressMiddleware(apollo, ...)` is mounted.
2. `notFoundHandler`/`errorHandler` (REST 404/500 fallbacks) must be registered **before** `httpServer.listen(...)`, not after — `axocom_backend` currently gets this wrong (see its `CLAUDE.md` §9); `un-backend` does it correctly.
3. `createLoaders()` is called inside the `context` factory, i.e. once per request — never at module scope, or DataLoader's cache will leak across users/requests.
4. `req.user` only gets set by `optionalAuth`; nothing upstream of the resolver ever rejects a request for being unauthenticated — that decision belongs to individual resolvers via `requireAuth`/`requireAdmin`.

## 3. Config loading

Both repos load env vars through a single `src/config/env.ts` module that is **gitignored** (each environment — dev machine, CI, prod host — provides its own, seeded from `.env` via `dotenv`, not committed). Pattern (from `un-backend`, the more complete version):

```typescript
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '..', '.env');
const result = config({ path: envPath });
if (result.error) console.warn(`Warning: Environment file not found at ${envPath}`);

export const PORT = process.env.PORT;
export const NODE_ENV = process.env.NODE_ENV;
export const DB_HOST = process.env.DB_HOST!;
export const DB_USER = process.env.DB_USER!;
export const DB_PASSWORD = process.env.DB_PASSWORD!;
export const DB_NAME = process.env.DB_NAME!;
export const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
export const JWT_SECRET = process.env.JWT_SECRET!;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;   // separate from JWT_SECRET
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN;
export const CORS_ORIGIN = process.env.CORS_ORIGIN;
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '500', 10);
```

Non-negotiable required vars (`DB_HOST`, `JWT_SECRET`, etc.) are asserted with `!` and will throw at import time if missing — that's intentional fail-fast behavior, keep it. Everything else has a sane default via `||`.

**Use a separate `JWT_REFRESH_SECRET` for refresh tokens, not the access-token secret.** `axocom_backend` currently signs both token types with the same `JWT_SECRET`; `un-backend` splits them. Splitting is strictly better (a leaked access-token secret doesn't also compromise the refresh flow) — do it this way in new work.

## 4. The four-file domain quartet

Every "thing" in the domain (candidate, article, user, election, mentor, ...) is implemented as four files with a fixed shape. Copy this shape exactly for a new domain — don't invent variations.

### 4a. Model — `models/<domain>.model.ts`

```typescript
import { RowDataPacket } from "mysql2";

export const CREATE_CANDIDATE_TABLE = `CREATE TABLE candidates (...)`;  // used only by repo tests
export const CANDIDATE_TABLE = 'candidates';

export interface Candidate extends RowDataPacket {
    id: number;
    name: string;
    // ...every column, typed
    created_at: Date;
}
```

- The table's column list lives **only** here. Nowhere else hardcodes column names as a literal string array — repositories reference `CANDIDATE_TABLE` and either `SELECT *` or an explicit column list matching this interface.
- If a domain needs a "public view" that hides sensitive columns (password hashes, internal admin notes), add a `XView` interface and a pure `convertXToView(x: X): XView` mapper function in the same model file (see `user.model.ts`'s `convertUserToView`), and call it at the resolver boundary — never leak the DB row type directly into a sensitive GraphQL response.

### 4b. Repository — `repositories/<domain>.repository.ts`

```typescript
import { db } from '../dataconfig/db';   // or '../database/db' in un-backend
import { Candidate, CANDIDATE_TABLE } from '../models/candidate.model';
import { err, ok, Result } from "neverthrow";
import createLogger from '../utils/logger';
import { ERRORS, RequestError } from '../utils/error';

const logger = createLogger('@candidate.repository');

class CandidateRepository {
    async getById(id: number): Promise<Result<Candidate, RequestError>> {
        try {
            const [rows] = await db.execute<Candidate[]>(
                `SELECT * FROM ${CANDIDATE_TABLE} WHERE id = ?`, [id]
            );
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

Rules, no exceptions:
- **Every** public method returns `Promise<Result<T, RequestError>>`. Never `throw` out of a repository method (the one narrow exception: pure helpers like `decodeCursor` that are expected to throw on genuinely-impossible input, and are always called from inside a resolver's own error handling).
- **Every** query is parameterized (`?` placeholders + a params array). Table/column names are safe to interpolate because they're compile-time constants (`CANDIDATE_TABLE`), never runtime/user-controlled strings.
- **Every** catch block: log with the repo's own labeled logger, then `return err(ERRORS.DATABASE_ERROR)` (or a more specific `ERRORS.*` entry when you can distinguish the failure, e.g. duplicate-key detection — see §7).
- One `class` per file, one exported singleton instance (`export const xRepository = new XRepository()`). Don't export the class itself or make methods static — the singleton-instance pattern is what makes `jest.spyOn(xRepository, 'method')` work cleanly in tests.
- For filtered/paginated list queries, build the `WHERE` clause incrementally as `(clauses: string[], params: unknown[])` pairs and join at the end — see §6 for the full cursor-pagination pattern from `un-backend`.

### 4c. Resolver — `graphql/resolvers/<domain>.resolver.ts`

```typescript
import { GraphQLError } from 'graphql';
import { DateTimeResolver } from 'graphql-scalars';
import GraphQLJSON from 'graphql-type-json';
import { candidateRepository } from '../../repositories/candidate.repository';
import createLogger from '../../utils/logger';
import type { GraphQLContext } from '../context';
import { requireAuth, toGraphQLError } from '../context';

const logger = createLogger('@candidate.resolver');

export const candidateResolvers = {
    JSON: GraphQLJSON,             // re-declared per module; mergeResolvers de-dupes identical scalars
    DateTime: DateTimeResolver,

    // Field resolver — relational field, resolved via a DataLoader, never a raw repo call
    Candidate: {
        party: (parent: Candidate, _: unknown, context: GraphQLContext) =>
            context.loaders.partyLoader.load(parent.party_id),
    },

    Query: {
        candidate: async (_: unknown, { id }: { id: number }, context: GraphQLContext) => {
            requireAuth(context);                       // enforce auth INSIDE the resolver
            const result = await candidateRepository.getById(id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },
    },

    Mutation: {
        updateCandidate: async (_: unknown, { id, input }: { id: number; input: unknown }, context: GraphQLContext) => {
            const admin = requireAdmin(context);         // mutations that change data are usually admin-only
            // ...validate input, call repository, handle Result
        },
    },
};
```

Rules:
- Auth is a resolver-level decision, made with `requireAuth(context)` / `requireAdmin(context)` (both live in `graphql/context.ts`, both throw a `GraphQLError` immediately if the check fails — nothing to check, they either return `TokenData` or throw). Call them at the very top of the resolver, before touching the repository, so unauthenticated requests never reach the DB.
- Convert repository errors with `toGraphQLError(result.error)` (see §5) rather than hand-writing `new GraphQLError(...)`. This keeps the Apollo `extensions.code` and the numeric `extensions.errorCode` consistent everywhere, and is half the line count.
- **Relational/nested fields always go through `context.loaders.*`, never a direct repository call.** This is the entire point of DataLoader: it batches the N per-parent lookups a nested GraphQL selection triggers into one SQL `IN (...)` query. A field resolver that calls `xRepository.getById()` directly reintroduces the N+1 problem the loader exists to prevent.
- Resolver files register their exported `<domain>Resolvers` object in `graphql/loaders/graphql.loader.ts`'s `mergeResolvers([...])` array — this step is manual, unlike schema files which are auto-discovered by glob. Forgetting to add a new resolver module here is the single most common "why isn't my new field/mutation showing up" bug on this stack.

### 4d. Schema — `graphql/schema/<domain>.schema.gql`

Plain SDL, one file per domain, auto-loaded recursively from `graphql/schema/` by `loadFilesSync` + `mergeTypeDefs`. Conventions:
- `scalar JSON` and `scalar DateTime` are declared once (in any one schema file — SDL declarations merge) and backed by `graphql-type-json`'s `GraphQLJSON` and `graphql-scalars`' `DateTimeResolver` respectively.
- `type Query { ... }` and `type Mutation { ... }` blocks in every domain's schema file are merged together by `mergeTypeDefs` — you're extending the root types, not redefining them; don't add `extend` keywords, plain `type Query { myNewField: ... }` blocks in separate files merge automatically.
- Input types (`CreateXInput`, `UpdateXInput`) mirror the model's mutable fields; `UpdateXInput` fields are all optional, `CreateXInput` marks required-at-creation fields with `!`.

## 5. Centralized error handling — `RequestError` + `ERRORS` + `toGraphQLError`

One file, `src/utils/error.ts`, defines every domain error as a `RequestError` (message + 5-digit numeric `code` + HTTP-style `statusCode`) in a single `ERRORS` const:

```typescript
export class RequestError extends Error {
    code: number;
    statusCode: number;
    constructor(message: string, code: number, statusCode: number) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
        this.statusCode = statusCode;
        if (Error.captureStackTrace) Error.captureStackTrace(this, RequestError);
    }
}

export const ERRORS = {
    DATABASE_ERROR: new RequestError("Database operation failed", 10001, 500),
    UNAUTHORIZED: new RequestError("Unauthorized access", 20005, 401),
    CANDIDATE_NOT_FOUND: new RequestError("Candidate not found", 30001, 404),
    // ...
} as const;
```

**Numeric code convention (own a range per domain, never reuse a number):**

| Range | Domain |
|---|---|
| 1xxxx | Common/general — DB errors, malformed body, generic validation |
| 2xxxx | Auth & authorization |
| 3xxxx | Primary entity #1 (candidate / user, depending on project) |
| 4xxxx | Primary entity #2 (admin / article, depending on project) |
| 5xxxx | Secondary domain (voter/election/party / file upload, depending on project) |
| 6xxxx+ | Project-specific extra domains (hackathon submissions, ads, ...) |

Within a domain's range, group related errors adjacently and leave gaps (`400xx` validation, `4002x` CRUD failures, `4003x` field-required errors) so a new error slots in near its siblings instead of at the end of an unordered list — see `un-backend/src/utils/error.ts`'s `ARTICLE_*` block for the cleanest example of this.

**The conversion helper — put this in the shared error/context module and use it everywhere:**

```typescript
function statusToGraphQLCode(statusCode: number): string {
    switch (statusCode) {
        case 400: return 'BAD_USER_INPUT';
        case 401: return 'UNAUTHORIZED';
        case 403: return 'FORBIDDEN';
        case 404: return 'NOT_FOUND';
        case 409: return 'DUPLICATE_RESOURCE';   // or 'CONFLICT'
        case 422: return 'BAD_USER_INPUT';
        default: return 'INTERNAL_SERVER_ERROR';
    }
}

export function toGraphQLError(error: RequestError): GraphQLError {
    return new GraphQLError(error.message, {
        extensions: { code: statusToGraphQLCode(error.statusCode), statusCode: error.statusCode, errorCode: error.code },
    });
}
```

Then every resolver's error path is one line: `if (result.isErr()) throw toGraphQLError(result.error);`. **Don't hand-construct `new GraphQLError(...)` with an inline `extensions: { code: '30001' }` in a resolver** — it's more code, and it's easy for the string-vs-numeric `code` to drift out of sync with what's registered in `ERRORS`. (`axocom_backend` has both styles today because it grew organically; `un-backend` standardized on `toGraphQLError` everywhere. Write new resolvers the `un-backend` way.)

`isDuplicateKeyError(error: unknown)` is a small helper worth keeping alongside `ERRORS` — it inspects a caught mysql2 error for `code === 'ER_DUP_ENTRY'` / `errno === 1062` so a repository's `create()` method can distinguish "this email/entry already exists" from a generic `DATABASE_ERROR`:

```typescript
async create(data: {...}): Promise<Result<User, RequestError>> {
    try {
        // ... INSERT
    } catch (error) {
        if (isDuplicateKeyError(error)) return err(ERRORS.EMAIL_ALREADY_EXISTS);
        logger.error('Error creating user:', error);
        return err(ERRORS.DATABASE_ERROR);
    }
}
```

## 6. Query optimization — DataLoader, and cursor pagination for lists

### DataLoader (both repos)

`graphql/loaders/dataloader.ts` (or `user.loader.ts`): a batch function per entity, keyed by ID, returning results **in the same order as the input ID array** (this ordering contract is DataLoader's core requirement — get it wrong and fields silently resolve to the wrong parent):

```typescript
async function batchCandidates(ids: readonly number[]): Promise<(Candidate | null)[]> {
    const [rows] = await db.execute<Candidate[]>(
        `SELECT * FROM ${CANDIDATE_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`, [...ids]
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);   // preserves input order, nulls for misses
}

export function createLoaders() {
    return {
        candidateLoader: new DataLoader(batchCandidates),
        partyLoader: new DataLoader(batchParties),
    };
}
export type Loaders = ReturnType<typeof createLoaders>;
```

Called once per HTTP request from the Apollo `context` factory — this is what gives each request (and therefore each user) an isolated cache, so one user's loaded data never leaks into another's response via a shared module-level cache.

### Cursor pagination (the pattern `un-backend` has and `axocom_backend` doesn't yet)

`types/pagination.ts` — Relay-style connection helpers, ID-based opaque cursors (base64 of the numeric ID):

```typescript
export type PageInfo = { startCursor: string | null; endCursor: string | null; hasNextPage: boolean };
export type Edge<T> = { cursor: string; node: T };
export type Connection<T> = { edges: Edge<T>[]; pageInfo: PageInfo };
export interface PaginationArgs { first?: number; after?: string; }

export function encodeCursor(id: number): string { return Buffer.from(String(id)).toString('base64'); }
export function decodeCursor(cursor: string): number {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const id = parseInt(decoded, 10);
    if (isNaN(id)) throw new Error('Invalid cursor');
    return id;
}

export function buildConnection<T extends { id: number }>(nodes: T[], hasMore: boolean): Connection<T> {
    const edges = nodes.map((node) => ({ cursor: encodeCursor(node.id), node }));
    return {
        edges,
        pageInfo: {
            startCursor: edges.length ? edges[0].cursor : null,
            endCursor: edges.length ? edges[edges.length - 1].cursor : null,
            hasNextPage: hasMore,
        },
    };
}
```

Repository side — fetch `limit + 1` rows to cheaply know `hasMore` without a second `COUNT(*)` query on the hot path:

```typescript
async findPaginated(pagination: PaginationArgs, filter?: ArticleFilter) {
    const clauses: string[] = []; const params: unknown[] = [];
    // ...push filter clauses...
    if (pagination.after) {
        clauses.push('a.id > ?');
        params.push(decodeCursor(pagination.after));
    }
    const limit = pagination.first || 10;
    const sql = `SELECT a.* FROM articles a WHERE ${clauses.join(' AND ')} ORDER BY a.id ASC LIMIT ?`;
    params.push(limit + 1);
    const [rows] = await db.query<Article[]>(sql, params);
    const hasMore = rows.length > limit;
    return ok({ articles: hasMore ? rows.slice(0, limit) : rows, hasMore });
}
```

Resolver side validates `first` against a `MAX_PAGE_SIZE` (throw `ERRORS.PAGINATION_LIMIT_EXCEEDED` above it) and defaults it via `DEFAULT_PAGE_SIZE` when omitted, then calls `buildConnection()` and a separate `countX()` repository method for `totalCount` if the schema exposes one.

If you're adding a paginated list query in `axocom_backend`, port this file wholesale from `un-backend/src/types/pagination.ts` rather than reinventing offset pagination.

## 7. Auth (JWT) end to end

- **Signup/login** (`auth.resolver.ts`) hash with `bcrypt.hash(password, 12)`, validate required fields and a minimum password length by hand in the resolver (not schema-level — GraphQL's type system can't express "min length 8"), then issue both tokens and return `{ access_token, refresh_token, user }`.
- **Access token**: long-ish lived (weeks), attached by the client as `Authorization: Bearer <token>`, decoded per-request by `optionalAuth` into `req.user` → `context.user`.
- **Refresh token**: short-lived by comparison (7 days) — sign it with a **separate secret** (`JWT_REFRESH_SECRET`, see §3) so a leaked access-token secret can't be used to mint refresh tokens.
- **`TokenData`** is the JWT payload shape: `{ id (or userId), is_admin, email?, name? }` — keep it minimal, it's sent to the client and decoded client-side too (JWTs are base64, not encrypted).
- **`requireAuth`/`requireAdmin`** (`graphql/context.ts`) are the only place authorization logic should live for GraphQL. Don't duplicate an `if (!context.user)` check inline in a resolver — call `requireAuth(context)`, which throws the right `GraphQLError` for you and gives you back a typed `TokenData`.
- REST-only routes (file export/upload) that need auth use a parallel Express middleware, `requireAuthMiddleware`, which does the same JWT decode but responds with a plain `401 { success: false, message: 'Unauthorized' }` instead of throwing a `GraphQLError` — REST and GraphQL auth checks are separate code paths on purpose, since they need to fail in their respective protocols' idioms.

## 8. Testing conventions

Two tiers, both using Jest + `neverthrow`'s `ok`/`err`:

**Repository tests** (`*.repository.test.ts`) — real, disposable MySQL via `testcontainers`:
```typescript
jest.mock('../dataconfig/db', () => ({ get db() { return mockPool; } }));

beforeAll(async () => {
    container = await new GenericContainer('mysql:latest')
        .withExposedPorts(3306)
        .withEnvironment({ MYSQL_ROOT_PASSWORD: 'root', MYSQL_DATABASE: 'test_db', MYSQL_USER: 'test_user', MYSQL_PASSWORD: 'test_password' })
        .start();
    mockPool = mysql.createPool({ host: 'localhost', port: container.getMappedPort(3306), user: 'test_user', password: 'test_password', database: 'test_db' });
    await setupDatabase();   // runs CREATE_X_TABLE from the model file
});
```
These assert directly against `result.isOk()/isErr()` and `result.value/result.error` — no mocking inside these tests, the DB is real (just ephemeral).

**Resolver/integration tests** (`*.integration.test.ts`) — a real `ApolloServer` instance, repository layer mocked:
```typescript
const server = createTestServer();   // wraps buildGraphQL() output in an ApolloServer
jest.spyOn(candidateRepository, 'getById').mockResolvedValue(ok(mockCandidate));
const response = await server.executeOperation(
    { query: GET_CANDIDATE, variables: { id: 1 } },
    { contextValue: createContext({ user: authedUser }) }   // createContext() from tests/setup.ts
);
```
These test schema + resolver + auth wiring end-to-end without touching a real database. Use `createContext({ user: null })` to assert an unauthenticated request gets the right `UNAUTHORIZED` extension code.

Coverage gate (per both repos' documented target): 70% branches/functions/lines/statements — check the actual `jest.config.*` in the repo you're in before assuming it's enforced, rather than trusting the README.

## 9. Style & tooling baseline

- `.prettierrc`: 4-space indent, single quotes, semicolons, ES5 trailing commas, 100-col width, `arrowParens: always`, LF line endings — identical in both repos, don't deviate.
- `"type": "module"` in `package.json` — ES modules throughout; `un-backend` additionally imports with explicit `.ts` extensions (`from './config/env.ts'`) because it runs under `tsx`/native ESM resolution — match whichever import-extension convention the repo you're in already uses, don't mix styles within one file.
- Logging: `winston`, always via a per-module `createLogger('@<module-name>')` at the top of the file, never a bare `console.log` inside business logic (error middleware is sometimes the lone exception — still prefer the logger there in new code).
- Error middleware differs slightly between the repos: `un-backend`'s `errorHandler` checks `error instanceof RequestError` first and uses its real `statusCode`/`code`; `axocom_backend`'s doesn't have that branch yet and falls through to a generic 500 for any thrown error. If you're touching REST error handling in `axocom_backend`, bring it in line with `un-backend`'s version.

## 10. Quick "adding a new domain" checklist

1. `models/<domain>.model.ts` — interface extending `RowDataPacket`, `<DOMAIN>_TABLE` const, optional `CREATE_<DOMAIN>_TABLE` DDL for tests.
2. `repositories/<domain>.repository.ts` — class + singleton export, every method wrapped in try/catch returning `Result`.
3. `graphql/schema/<domain>.schema.gql` — types, inputs, `Query`/`Mutation` extensions (auto-discovered by the schema loader glob — no registration step needed).
4. `graphql/resolvers/<domain>.resolver.ts` — export `<domain>Resolvers`; use `requireAuth`/`requireAdmin` + `toGraphQLError`; relational fields via `context.loaders.*`.
5. **Register the resolver module** in `graphql/loaders/graphql.loader.ts`'s `mergeResolvers([...])` array — this step is manual and easy to forget.
6. If the new domain has a foreign key another type resolves through, add a batch function + loader entry in `graphql/loaders/dataloader.ts`.
7. Add new error codes to `ERRORS` in `utils/error.ts`, in the domain's numeric range, no duplicate codes.
8. Write a `*.repository.test.ts` (testcontainers) and a `*.integration.test.ts` (mocked repo, real Apollo server) alongside the new files.
