# Sign-in and bring-your-own-key (T12.1–T12.5) — design

Status: owner request 2026-10-31 ("write up the design for sign-in and byok"), following the decision that a hosted Table Read runs on each writer's own Anthropic API key and credits. The owner prefers decisions made and marked over an up-front interview: every _(call)_ below is a default for the owner to check in review. The four decisions only the owner could make were answered on 2026-10-31 and are recorded under **Owner decisions**.

## Why

Table Read today is a single-user local app: no users, every project visible to everyone who can reach the server, and one server-wide `ANTHROPIC_API_KEY` that pays for everything. To put it online, two things must be true:

1. **A writer's scripts are theirs alone.** A screenplay is unreleased creative work. The design doc already promises it "isn't stored beyond their control or seen by anyone else" (§7.1).
2. **A writer's AI usage is paid by their own key, never the operator's,** with the price shown before an import, a live meter, and a hard spending limit — Milestone 11 already built the cost side.

## Goals

1. A writer signs in with their email and sees only their own projects. Every route that reads or changes a project refuses everyone else.
2. A writer adds their Anthropic API key once in Settings. It is validated, stored encrypted, never shown again in full, never logged, and removable at any time.
3. Every AI call a signed-in writer triggers is made with their key. In hosted mode the server's own key is never used for a writer.
4. A wrong key, an empty account and a spend cap each get their own plain-language message, and fixing the key lets the writer retry.
5. A writer can sign out and can delete their account, which removes every project, saved import, key and session.
6. **Running locally doesn't change.** `make dev` keeps working exactly as today: no sign-in, the server's key or the mock.

## Non-goals

- Google / OAuth sign-in, passwords, two-factor, changing your email. _(call: magic links first; Google is the likely second method)_
- Teams, sharing, collaboration (design doc §8: v2/v3).
- Billing, "Table Read credits", paying for writers' usage.
- Deployment and hosting (Fly, a domain for the app, backups, Postgres). A separate milestone; this design only requires what any host provides (HTTPS, environment secrets, one persistent disk).
- An admin dashboard.

## Anti-goals

- **Any path by which one writer can read, list, export, replay or delete another's work** — including through ids that aren't project ids (facts, notes, change sets, import idempotency keys).
- **The operator's key paying for a writer** because a writer has no key, or because a server-wide `ANTHROPIC_API_KEY` happened to be set.
- A writer's key in a log line, an error message, an API response, the database in plain text, or the browser.
- Breaking the owner's local workflow or the existing test suites.

## Two modes

`TABLEREAD_MODE` selects the mode at startup _(call)_:

| | `local` (default) | `hosted` |
|---|---|---|
| Sign-in | none — one implicit local user owns everything | required for everything except `/health`, sign-in routes and static files |
| AI key | `ANTHROPIC_API_KEY` or the mock, exactly as today | the signed-in writer's stored key only; the server's `ANTHROPIC_API_KEY` is ignored for writers (logged once at startup if set) |
| Startup checks | none new | refuses to start without `TABLEREAD_KEY_ENCRYPTION_KEY`, an email sender configuration and `TABLEREAD_APP_ORIGIN` |

Local mode is the default so `make dev`, every existing pytest module and every existing e2e spec run unchanged. Everything hosted-only is behind the mode, and new tests run the hosted mode explicitly.

## T12.1 Sign-in (users, sessions, magic links)

**Storage.** New tables:
- `users`: `id`, `email` (lowercased, unique), `created_at`, `last_sign_in_at`.
- `login_tokens`: `token_hash`, `user_email`, `expires_at`, `used_at`.
- `sessions`: `token_hash`, `user_id`, `created_at`, `expires_at`, `last_seen_at`.

Tokens are 32 random bytes (`secrets`). Only their SHA-256 is stored. No new dependency.

**Flow.**
1. **Request a link.** `POST /api/v1/auth/link {email}` always answers "Check your email", so it never reveals whether an account exists. It creates the user if new (sign-up is open — Owner decision 2) and emails a one-time link valid for 15 minutes _(call)_.
2. **Open the link, then confirm.** The emailed link opens `/signin/confirm?token=…`. That page only shows "Sign in as you@…?" and a **Sign in** button; it changes nothing. The button calls `POST /api/v1/auth/verify {token}`, which checks the token is unused and unexpired, marks it used, creates a session, and sets the cookie `tr_session` (HttpOnly; Secure in hosted mode; SameSite=Lax; Path=/). The page then goes to `/projects`. A bad or expired token shows "That link has expired — send a new one."
   - **Why two steps:** work email security scanners (Safe Links, Mimecast, Proofpoint) open every link in a message. A link that signed you in on open would be used up by the scanner, and someone could sign a victim into the sender's account by mailing them a link _(call)_.
   - **Any device:** the link works wherever it's opened, not only on the device that asked for it _(call)_.
3. **Who's signed in.** `GET /api/v1/me` returns `{email, mode, hasApiKey, keyHint, llmMode}`. In local mode it returns `{mode: "local", llmMode, …}` with no email.
4. **Sign out.** `POST /api/v1/auth/signout` deletes the session row and clears the cookie.

**Session lifetime.** Sessions last 30 days and slide on use _(call)_.

**Throttling.** At most 5 links per email per hour and 20 per IP per hour, counted in the database _(call)_. With open sign-up this is also the spam guard: nobody can use the form to flood an inbox, and an account costs the operator nothing until its writer adds their own key. If abuse appears anyway, a challenge on the link form is the next step (out of scope).

**Email.** One small sender interface. In hosted mode it posts to Resend's HTTPS API (Owner decision 3) using `httpx`, which is already installed with the `anthropic` SDK. In local mode, or with `TABLEREAD_DEV_AUTH=1` (e2e only), it writes the link to a dev-only endpoint `GET /api/v1/auth/dev-last-link`. That endpoint answers 404 in hosted mode without the flag. It never writes the link to the log.

**One origin.** In hosted mode the API serves the built web app (`apps/web/dist`) from the same origin, so the cookie, the Origin check below and every relative `/api/v1` call work without cross-site setup _(call)_. Hosting the web app separately (for example on Netlify like the landing page) is out of scope. It would need a different cookie and CSRF design.

**CSRF.** In hosted mode, every POST, PATCH and DELETE must carry an `Origin` header equal to `TABLEREAD_APP_ORIGIN`, or it gets 403 _(call: an Origin check plus SameSite=Lax, no token plumbing — the web app's ~10 direct `fetch` calls stay untouched)_.

**UI.**
- **`/signin`.** An email field, **Email me a sign-in link**, and a "Check your email" state with "Didn't get it? Send another" after 30 s. An expired link shows "That link has expired — send a new one."
- **Dashboard header.** The hard-coded "RN" avatar becomes the signed-in writer's initials with a menu: their email · **Settings** · **Sign out**. The dashboard's dead Settings button opens the account settings.
- **Signed out.** Any page sends you to `/signin`. After sign-in you return to the page you asked for.

## T12.2 Private projects (ownership everywhere)

**Owner columns.** `projects.owner_user_id` and `import_runs.owner_user_id` are added by `ALTER TABLE` like the existing columns. They stay nullable so existing local databases load.
- **Local mode** treats every row as the local user's.
- **Hosted mode** requires an owner on every new row. A hosted request treats a NULL-owner row as not found.

**One ownership gate.** Two FastAPI dependencies do all the checking:
- `current_user` (local: the implicit user)
- `owned_project(pid)`

A project that isn't yours is **404, not 403**, so its existence never leaks. Routes keyed by a child id find the parent project and run the same check:
- `/ledger/{fact_id}`
- `/consistency-flags/{fid}`
- `/change-sets/{cid}`
- narrative-map runs

`GET /projects` lists only your projects.

**A test that walks every route.** It enumerates the app's routes and asserts that each one taking a project or child id resolves through the gate. A new route that forgets the gate fails CI. Isolation tests then run writer B against writer A's objects across every route family:

- read
- list
- patch
- delete
- undo / restore
- export
- ledger
- flags
- change sets
- structure / craft / narrative map
- candidates
- import replay

**The two known leaks.**
- **Idempotency keys** (`projects.creation_idempotency_key`, `import_runs.idempotency_key`) become unique per owner, not across the table. A replay only matches your own runs. Without this, sending another writer's key and script returns their project.
- **`purge_project`** deletes only the deleting writer's import runs. Today it matches runs by the script's hash, so it can delete another writer's saved import of the same script.

**Claiming existing projects.** `python -m storage.assign_owner --email you@…` assigns every ownerless project and import run to one account. The owner runs it once when moving a local database to hosting _(call)_.

## T12.3 Your API key (storage and Settings)

**Storage.** An `api_keys` table: `user_id` (unique), `ciphertext`, `key_hint` (the last 4 characters), `created_at`, `last_validated_at`, `status` (`ok` | `invalid` | `out_of_credits`).
- The key is encrypted with AES-GCM under `TABLEREAD_KEY_ENCRYPTION_KEY` (32 bytes, a host secret).
- A key-version byte is stored so the master key can be rotated later.
- This adds the `cryptography` package, flagged in the PR per hard rule 10. The standard library has no authenticated encryption.
- Decryption with the wrong master key fails closed: the writer is asked to add the key again. Nothing falls back to plain text.

**Validation.** Saving a key calls the Models API (`GET /v1/models`) with it. That uses no tokens.
- A 401 rejects the key: "Anthropic didn't accept this key."
- Anything else that fails is saved with a warning _(call)_.
- The key never enters a log line, an error message, a response body or the browser after it's submitted.
- Responses carry only `keyHint` ("…AbCd") and `status`.

**Settings page** (`/settings`, signed-in):
- **Your Anthropic API key.** Status line ("Key ending AbCd · working", "No key yet") with **Add key** / **Replace** / **Remove**.
- **Getting a key.** A short guide: create an account at the Claude Console, add credits, create a key just for Table Read, and set a monthly spend limit on it. The last step says why: "a key with its own limit is the simplest protection".
- **Privacy.** "Your scripts are sent to Anthropic's API using your key, under your Anthropic account's terms. Table Read doesn't use them for anything else."
- **Delete account** (T12.5).

**Without a key.** In hosted mode a writer without a working key is sent to Settings after sign-in: "Table Read needs your Anthropic API key to work." Projects can be listed, opened, read and exported, but not changed. Many ordinary edits run the model behind the scenes — a Plan edit's consistency scan, accepting a beat's fact extraction, Change Sets — so allowing edits without a key would either skip those checks silently or refuse the edit and lose the writer's text (Owner decision 1).
- **If the key stops working mid-session** (removed elsewhere, out of credits), an edit that was already typed still saves. Its background check is skipped and filed as a note: "Not checked for contradictions — your Anthropic key isn't working." The writer's text is never discarded _(call)_.
- **Visible AI actions** stay visible and say **Add your API key in Settings to use this** instead of running. This replaces today's "Demo mode — set an API key and restart" banner in hosted mode.
- AI actions: Next Beat, Tune, Suggest, Check structure, Check craft, Narrative Map, Import's Analyze.
- Nothing calls a model without a key, and nothing quietly uses another key.

## T12.4 Every AI call on the writer's key

**Client.** `get_llm_client` keeps its name and signature, so every test override still works. It resolves the client per request:
- **Local mode:** today's behaviour.
- **Hosted mode:** the current writer's decrypted key builds the client.
  - Clients are cached in memory per (writer, key version), evicted on replace or remove, and never cached across writers _(call)_.
  - A writer with no key gets 409 `API_KEY_REQUIRED`.
  - The process-wide `_client` cache is only for local mode.

**Work that outlives the request.**
- **Imports** run inside their event stream and keep the client they started with.
- **Narrative Map runs** keep theirs in the background worker.
- **A resumed import or map** resolves the writer's current key on the request that resumes it.
- **Replacing or removing a key, or deleting the account,** stops that writer's running imports and Narrative Map runs at their next step. The import pipeline and the map worker check a per-writer "stop" signal before each stage and each fan-out unit. Calls already sent finish, and nothing new starts on the old key.
  - A stopped import pauses as resumable with `API_KEY_REQUIRED`.
  - A stopped map ends as interrupted.
  - On account deletion the stop happens first. The purge waits for in-flight calls to return. A pipeline whose owner no longer exists never creates a project or writes a snapshot _(call)_.

**Errors** become distinct codes in data contract §4, mapped in one place for the synchronous routes, the import stream and the map worker:

| Anthropic says | Code | Writer sees | Resumable |
|---|---|---|---|
| 401 | `API_KEY_INVALID` | "Anthropic rejected your API key. Replace it in Settings." | after the key is fixed |
| 402 `billing_error`, `enforced_spend_limit_reached`, usage-limit 400 | `API_CREDITS_EXHAUSTED` | "Your Anthropic account is out of credits or hit its spend limit." | after credits are added |
| 429 (rate limit) after the existing backoff | `LLM_RATE_LIMITED` | "Anthropic is limiting requests on your account. Paused — continue in a minute." | yes — an import pauses at the last completed unit and resumes on Continue; the per-key limiter is halved for the next attempt _(call)_ |
| other / timeout | `LLM_UNAVAILABLE` / `LLM_TIMEOUT` | as today | as today |

Each also sets the key's `status`. A Narrative Map 401 is no longer terminal for that source, so a fixed key can rerun it.

**Rate limits.** New Anthropic accounts start with low limits, and an import fans out up to 8 calls per stage.
- In hosted mode each writer's calls share one limiter per key across all their runs: 4 concurrent calls by default (`TABLEREAD_HOSTED_CONCURRENCY`).
- On a 429 after backoff the limiter halves for that key and recovers slowly _(call)_.
- Each writer gets at most one Narrative Map run at a time, and the global pool of 2 map workers stays.
- The existing `anthropic-ratelimit-*` headers stay logged as numbers.

**Spending.** Milestone 11's estimate, meter and spending limit apply unchanged. The spending limit (T11.3, PR #57) must land before T12.4, because both pause an import as resumable and share the pause path. In hosted mode the wizard's line already reads "on your API key".

## T12.5 Sign out, delete account

**Delete account** (Settings, type your email to confirm) removes everything the writer owns in one transaction:
- every project, via the existing `purge_project`: snapshots, facts, flags, change sets, suggestion history, narrative-map runs
- their import runs and units
- their API key
- their sessions
- their login tokens
- the user row

After that it signs out and shows "Your account and all your projects were deleted." **Export project** stays available before deleting.

## Tests

**pytest** (hosted-mode tests run with `TABLEREAD_MODE=hosted` and two seeded writers):
- **Magic links:** single-use, expiry, no account enumeration, throttling, the dev link endpoint 404s in hosted mode, the token is never logged.
- **Sessions:** cookie flags, sliding expiry, sign-out.
- **CSRF:** a request with a bad Origin is refused.
- **Isolation:** the route-coverage test, and B-versus-A across every route family. Scoped idempotency (a replay of another writer's key is a fresh run, not their project). Scoped purge.
- **Key storage:**
  - the key never appears in responses, logs or the database in plain text
  - a wrong master key fails closed
  - validation on 401
- **Per-writer clients:**
  - the server's `ANTHROPIC_API_KEY` is never used in hosted mode
  - no key gives `API_KEY_REQUIRED`
  - caches never cross writers
- **Error mapping** for each row of the table, and the per-key limiter halving and recovering.
- **Account deletion** removes every owned row.

**Unchanged:** every existing test passes in local mode.

**Vitest:**
- the sign-in states
- the avatar menu
- the Settings key states
- the "add your key" gate on each AI action
- the delete-account confirmation

**E2E** (a separate Playwright project for hosted mode, using `TABLEREAD_DEV_AUTH=1` and the mock behind a validated test key): sign in via the dev link, add a key, import, and a second writer can't see the first writer's project. The existing specs stay on local mode.

## Owner decisions (answered 2026-10-31)

1. **Key required before editing.** In hosted mode a working key is required before projects can be changed. Read, open and export still work without one, so every contradiction check Table Read promises actually runs.
2. **Open sign-up.** Anyone with an email can create an account. Throttling on the link form is the abuse guard, and an account costs the operator nothing until its writer adds a key.
3. **Resend sends sign-in email.** This needs a Resend account and its DNS records on hellotableread.com (Namecheap); the operator sets these up. The API key goes in the host's secrets (`RESEND_API_KEY`), and the sender is `sign-in@hellotableread.com` _(call)_.
4. **Keys are encrypted on the server** (AES-GCM, adds `cryptography`, one host secret `TABLEREAD_KEY_ENCRYPTION_KEY`).

## Sequencing

T12.1 first (users, sessions, modes). Then T12.2 and T12.3 in parallel: one owns the project tables and routes, the other owns keys and Settings. Then T12.4, which needs both. T12.5 last. Each is one PR.
