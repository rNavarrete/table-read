# New project flow — design spec

**Date:** 2026-07-10  
**Status:** approved  
**Authority after merge:** this spec updates product behavior in `docs/narrative-sidekick-design-doc.md`, endpoint/type definitions in `docs/tableread-data-contract.md`, prompt behavior in `docs/tableread-prompt-spec.md`, and dashboard/onboarding behavior in `docs/tableread-ui-spec.md`. Executable schemas remain authoritative in `packages/contract`.

## 1. Goal

Replace the hardcoded seeded-project entry point with a calm, trustworthy project home where a writer can:

1. resume recent work;
2. create a project from an idea through guided setup; or
3. create a project by uploading or pasting a Fountain/plain-text/PDF script.

The selected dashboard direction is **Story Launcher**: creation is primary, recent work is secondary, and organization remains deliberately light.

The central trust promise is:

> **Every AI step is explicit, reviewable, and begins only after you confirm the source material.**

This is product behavior, not promotional copy.

## 2. Locked decisions

| Decision            | Choice                                                                           |
| ------------------- | -------------------------------------------------------------------------------- |
| App entry           | Project dashboard at `/projects`; no seeded-project fallback                     |
| Dashboard direction | Story Launcher                                                                   |
| New project entry   | Accent-token `+ New project` pill in the top-right plus two large launcher cards |
| Creation paths      | **Start from an idea** and **Import a script**                                   |
| Wizard style        | Short, stepwise wizard with Back/Cancel and locally preserved inputs             |
| Idea handoff        | Guided Plan setup: premise → characters → theme → optional scene skeleton        |
| Import inputs       | `.fountain` / `.txt` / `.pdf` upload **and** paste                               |
| Import handoff      | Plan with scenes/beats; Ledger badge for pending imported facts                  |
| AI behavior         | Never starts on upload, paste, blur, navigation, or project creation             |
| Deletion            | Permanent purge with typed-title confirmation; no Trash/archive fiction          |
| Visual system       | Existing Quiet Tool tokens and components; no new color language                 |

## 3. Non-goals

- FDX, RTF, Final Draft, or Word import. PDF is the approved single-episode exception: extract to editable text first, then use the existing text analyze path.
- Multiple episodes in one import
- Series-bible document import or automatic bible reverse-engineering
- Project folders, favorites, tags, cover art, templates marketplace, collaboration, or sharing
- Dashboard analytics, progress charts, activity feeds, or AI summaries
- Automatic plan generation during project creation
- Replacing the existing single-episode Fountain/plain-text import pipeline
- Calling the real Anthropic API in tests

## 4. Dashboard

### 4.1 Route and navigation

- `/projects` is the app root/home.
- A mode screen is always project-scoped via `?project=<id>`.
- Mode screens with no project id redirect to `/projects`; they no longer fall back to `proj-longpour`.
- Clicking the Table Read wordmark from a project returns to `/projects`.
- The seeded fixture remains ordinary development data and may appear in the list when the dev database is seeded.

### 4.2 Layout

Quiet Tool top bar:

- Table Read wordmark, left;
- `--tr-coral` accent `+ New project` pill, right;
- Settings and user/avatar affordance, right.

Centered Story Launcher content:

- eyebrow: **BEGIN**;
- heading: **What are we writing?**;
- subcopy: **Shape a new idea, or bring in a script you already have.**;
- two cards: **Start from an idea** and **Import a script**;
- **Continue writing** list;
- lightweight project-title search.

The top-right `+ New project` button opens the same path chooser as the launcher cards. The two launcher cards may deep-link directly to their path.

### 4.3 Recent project rows

Show at most five projects, ordered by server `updatedAt` descending. Each row contains:

- title;
- genre, runtime, and act count;
- actionable status;
- relative last-edited time;
- overflow menu.

Status priority:

1. `N facts to review` when pending Ledger facts exist;
2. `Continue setup` when the project has no usable scene skeleton (at least one scene containing at least one beat);
3. `Ready to write` otherwise.

Do not invent completion percentages. Clicking a row resumes the project’s last local mode and scene when valid, otherwise:

- setup-incomplete → guided Plan setup;
- imported/planned project → Write, first scene;
- project with pending facts still opens its last mode; the Ledger badge/status provides the review path.

The overflow menu contains Rename, Export Fountain, and Permanently delete. Delete requires entering the exact project title and then uses the canonical full purge endpoint.

### 4.4 Dashboard states

- **Loading:** stable skeleton matching the final launcher/list geometry.
- **No projects:** explain what a Table Read project contains; preserve both creation cards as direct actions.
- **No search results:** neutral message, clear search, keep `+ New project`.
- **API error:** concise message plus Retry; never substitute the fixture.

## 5. Wizard shell

The dashboard choice determines the path before the wizard opens. Both paths use:

- visible step labels;
- Back, Continue, Cancel;
- inline validation;
- browser-local draft persistence under a versioned key;
- no server project until final confirmation;
- the AI trust note near every AI-triggering action.

Back never discards valid input. Cancel confirms only when entered data exists. Successful creation clears the local draft. Stored drafts contain setup fields or the import source only in the writer’s browser and are cleared on successful completion or explicit discard.

## 6. Start from an idea

### Step 1 — Project basics

- Title (required)
- Premise (required; writer-authored)

### Step 2 — Format

Offer presets that populate the executable `ShowFormat`, then allow adjustment:

- One-hour drama
- Half-hour comedy
- Actless streaming

Fields: genre, runtime, act count, cold open, tag, serialization. Advanced format details stay collapsed until requested.

### Step 3 — Story foundation

Optional and editable:

- initial characters (name required per row; traits optional);
- existential/thematic question;
- stories to avoid.

`CharacterSeed` contains exactly `name` and optional `traits`. The server assigns the character ID, sets `locked: false`, maps supplied traits to `traits`, and deterministically initializes required `embodiment`, `presentation`, `hiding`, and `seriesArc` fields to empty strings. Clients never mint IDs; nothing is model-inferred.

### Step 4 — Review and create

Show a compact project summary and the trust note. The button is **Create project**, not “Generate” or “Continue.” It performs no LLM call.

Creation writes one project and one root snapshot atomically. The root snapshot contains the writer-confirmed title, premise, format, and supplied story-foundation fields.

### Guided Plan setup

After creation, open a progressive Plan setup surface:

1. premise;
2. characters;
3. theme;
4. scene skeleton.

Each section can be edited manually or skipped. **Generate scene skeleton** is a separate explicit gesture with a preflight summary of inputs. In accordance with the product-wide convergent loop, it generates **three** diverse skeleton candidates. The writer compares them side by side and chooses one (or chooses none and builds manually). Choosing a candidate creates an `initial_scene_skeleton` Change Set and sends the writer to the existing full Review mode. The AI proposal never writes directly.

Each candidate is bound to the current `headSnapshotId`. The chosen executable preview payload extends Change Sets with ordered scene additions containing:

- a server-assigned `proposalId` selection handle (not the final scene ID);
- act, location, time, social situation, `whatHappens`, audience learns/feels;
- motivations referencing existing character IDs;
- ordered beat-plan seeds;
- no server-owned scene/beat IDs and no generated `scriptText`.

MVP scene additions use storyline `A`; storyline inference/tagging remains deferred. In Review the writer may select whole proposed scenes by their server-assigned `proposalId`, then Apply or Discard. For this Change Set variant, `approvedObjectIds` contains proposal IDs; apply maps them to newly assigned final scene/beat IDs. Editing proposal fields before apply is out of scope; writers can apply and manually edit the resulting unlocked Plan, or discard and build manually.

Apply:

- rejects a stale `basedOnSnapshotId`;
- revalidates the stored preview (never trusts display snippets);
- routes through the lock filter;
- assigns all scene/beat IDs server-side;
- writes one snapshot;
- records the Change Set and snapshot instruction for audit;
- opens the resulting Plan board.

The lock-violation test for this new generation/apply path is written and passing **before** the feature test, per the repository’s zero-tolerance lock gate.

This operation changes prompts/tool schemas, so it requires `PROMPT_VERSION` bump, regenerated tool schemas, contract checks, and real-eval sign-off before merge. Do not run real evals without explicit user approval.

## 7. Import a script

### Step 1 — Add the script

Two tabs:

- **Upload:** `.fountain`, `.txt`, or `.pdf`; show filename, size, and detected format.
- **Paste:** plain textarea preserving source exactly.

The writer can replace the source before continuing. Unsupported extensions and empty files fail locally with clear guidance. Fountain/text content is read in the browser; selecting those files does not upload or analyze anything. Selecting a PDF uploads only to `POST /projects/import/extract-pdf`, which performs non-LLM server extraction and fills the next editable source step.

### Step 2 — Confirm source

Show an editable textarea containing pasted text, locally read Fountain/text, or server-extracted PDF text. PDF results show the extraction method (`Text layer` or `OCR`), page count, and warning codes. The writer may edit freely before analysis; PDF always continues as `format: "text"`.

### Step 3 — Confirm basics

Pre-fill title from the filename when available. Confirm title and `ShowFormat` using the same presets/fields as the idea path.

### Step 4 — Review source

Show:

- source type and filename (if uploaded);
- byte/character and line counts;
- deterministic detected scene count where available;
- the exact high-level outputs: scenes, beats, pending Ledger facts, consistency flags;
- the trust note.

The only trigger is **Create & analyze script**.

### Step 5 — Analyze

Show truthful named stages:

1. parsing scenes;
2. segmenting beats;
3. extracting facts;
4. checking consistency;
5. saving project.

The existing import invariants remain:

- deterministic scene ownership;
- model proposes line ranges but never transcribes source;
- complete, ordered, non-overlapping line coverage;
- all source text preserved byte-identical;
- all imported facts begin `pending_review`;
- consistency flags persist `open`;
- one atomic project/root import transaction;
- no fallback structure after schema-validation failure.

On success, open Plan with imported scenes/beats and show the Ledger pending-review badge. On failure, persist no project or partial rows; preserve browser-local wizard input and offer Retry/Edit source/Return to dashboard. PDF extraction failures happen before this step and create no project rows.

Import is the explicit exception to “review before AI-authored structural mutation”: the writer approves **Create & analyze script**, then deterministic/verbatim scene ownership plus model-proposed beat boundaries are saved atomically. The result remains reviewable and reversible in Plan/Undo; no model-generated script replaces source text; inferred facts still require Ledger review. This exception preserves the existing v1 import product contract rather than forcing a second full-script preview/apply copy.

## 8. AI trust interaction

The trust sentence is visible but quiet; it must not become repetitive banner noise.

For each AI operation:

1. describe the source that will be sent;
2. describe the expected output;
3. require an explicit verb-labelled button;
4. show truthful progress;
5. validate structured output;
6. present results for review before mutation;
7. persist only after writer approval.

For normal generation, review occurs before mutation through candidate acceptance or Change Sets. Import follows the explicit exception in §7: the writer approves analysis first, imported structure persists atomically, and its structure/facts remain reviewable afterward.

No writer text appears in logs. Log only IDs, hashes, model/version metadata, token counts, and stage status.

## 9. API and schema changes

Schema changes follow the “every home or none” rule:

- all listed request/response/event types: Zod in `packages/contract`, Pydantic mirror, and `docs/tableread-data-contract.md`;
- dashboard/wizard behavior: `docs/tableread-ui-spec.md`;
- new project/product behavior and the import review exception: `docs/narrative-sidekick-design-doc.md`;
- `InitialSceneSkeleton`: Zod tool output, Pydantic mirror, `docs/tableread-prompt-spec.md` summary, regenerated `config/tool_schemas/`, and prompt-version/eval obligations;
- acceptance coverage: `docs/tableread-test-plan.md` and build tasks in `docs/tableread-build-plan.md`.

`make check-contract` must prove the executable homes agree.

### 9.1 Project summaries

Add executable Zod/Pydantic `ProjectSummary`:

- `id`
- `title`
- `format`
- `updatedAt`
- `pendingReviewCount`
- `setupState: "incomplete" | "ready"`

`GET /projects` returns `ProjectSummary[]` sorted by `updatedAt` descending. It must not return full documents or writer text beyond project titles. Pending count is derived from ledger rows; setup state is derived from the document.

`updatedAt` is RFC 3339 UTC on the wire. `setupState` is `ready` iff the project contains at least one scene with at least one beat; otherwise it is `incomplete`.

### 9.2 Idea creation

Add executable Zod/Pydantic `CharacterSeed`, `ProjectFoundationInput`, and `ProjectCreateRequest`. Extend project creation with:

- existing title, format, premise;
- optional `foundation` containing existential question, stories to avoid, and character seeds without IDs.

The server validates, assigns IDs, builds the canonical `SeriesBible`, and creates the root snapshot atomically. Existing minimal requests remain valid.

### 9.3 Atomic create-and-import

Add executable Zod/Pydantic `ProjectImportCreateRequest`, `ProjectImportProgressEvent`, and `ProjectImportResult`. The create-and-import operation accepts project basics plus `{format: "fountain" | "text", content}`. It reuses the existing parse/import pipeline but creates the project and imported state in one database transaction.

Implementation must refactor transaction boundaries rather than create then delete on failure. A failed operation leaves no project, snapshots, facts, flags, Change Sets, or suggestion history.

The operation produces **exactly one root snapshot** (`parentId: null`) containing the final imported project document, Ledger, and consistency flags; it does not create an empty root followed by an import child.

Named import progress uses an SSE response because the writer explicitly triggered it. `ProjectImportProgressEvent` is a discriminated union of stage events plus terminal `complete {result: ProjectImportResult}` and `failed {error}` events. Import progress transport is documented in the data contract and UI spec; prompt spec §7 remains authoritative for the existing segmentation model call and is updated only to cross-reference the transport stages.

Both project-creation operations require an `Idempotency-Key` header generated once per final wizard submission and retained with the local draft. A storage-only unique creation key on the project row lets the server return the already-created result if the terminal response was lost, preventing duplicate projects. This correlation key is not a domain object ID and contains no writer text.

Idempotency semantics:

- key: opaque UUID, scoped to project creation, retained for the life of the project;
- same key + same canonical request hash after success: replay the existing result (for SSE, emit terminal `complete`);
- same key + different request hash: 409 `IDEMPOTENCY_CONFLICT`;
- failed transaction: no key/project row persists, so retry may execute normally;
- deleting the project deletes the key with its project row.

### 9.4 Scene-skeleton Change Set

Add the LLM tool-output schema `InitialSceneSkeleton`, invoke it through the existing three-candidate generation loop, and expose validated `InitialSceneSkeletonCandidate` values with `candidateId`, `basedOnSnapshotId`, and server-assigned scene `proposalId` handles. Selecting a candidate creates a persisted Change Set. Extend typed Change Set previews with an `initial_scene_skeleton` variant containing the chosen scene additions and `basedOnSnapshotId`. Zod, Pydantic, prompt-spec summary, and generated tool schemas change together. Stored preview payload—not rendered snippets—is the only apply input.

### 9.5 Resume context

Last mode and scene remain browser-local, keyed by project ID and versioned. Invalid/stale scene IDs fall back to the first scene; unavailable modes fall back to guided setup or Write. No contract or database field is needed.

## 10. Accessibility and responsive behavior

- Entire wizard is keyboard operable with visible token-backed focus states.
- Step state and validation are announced semantically, not by color alone.
- File dropzone always has a normal file-input equivalent.
- Progress stages use text plus status semantics; no spinner-only waiting state.
- Focus moves to the first invalid field on submit.
- On narrow screens, creation cards and project metadata stack; project actions remain reachable.
- Respect reduced motion.

## 11. Error handling

- API errors use the canonical `{error: {code, message, details?}}` shape.
- Duplicate submits are disabled while pending.
- Validation errors preserve all local inputs.
- LLM structured-output failures get exactly one retry with the validation error appended, then surface `SCHEMA_INVALID_LLM`.
- Network failure during import offers safe retry and never claims success.
- Project-list failure never silently displays stale seeded data.
- Permanent-delete failure leaves the project visible and reports the error.

## 12. Testing and acceptance

### Contract/API

- `ProjectSummary` Zod ↔ Pydantic parity.
- `GET /projects` ordering, derived statuses/counts, and no full writer content.
- Idea creation assigns character IDs and puts supplied foundation into the root snapshot.
- Atomic create-and-import success creates exactly one project and exactly one root snapshot containing imported doc/ledger/flags.
- Fault injection at every import stage leaves zero project-scoped rows.
- Same idempotency key/request replays success; same key/different request 409s; failed transaction leaves the key reusable.
- Import coverage, pending-fact, consistency, privacy, and schema-retry guarantees remain covered.
- Initial-scene-skeleton lock-violation test precedes feature tests; exactly three candidates, stale preview, stored-preview apply, proposal-ID selection, final server ID assignment, selective scene apply, discard, and one-snapshot apply are covered.
- Delete still purges all canonical stores.

### Web

- Dashboard loading, empty, populated, search-empty, and error states.
- No seeded fallback without `?project=`.
- Recent row status priority and resume fallback.
- Both wizard paths preserve Back/refresh draft state and clear it on success.
- Upload and paste do nothing until explicit confirmation.
- Idea creation makes no LLM request.
- Import progress and failure recovery are truthful.
- Keyboard, focus, and reduced-motion behavior.

### E2E

1. Empty DB → dashboard → Start from idea → create → guided Plan setup.
2. Dashboard → Import → upload fixture Fountain → explicit create/analyze → Plan scenes/beats → Ledger pending queue.
3. Inject import failure → no project appears → source remains available for retry.
4. Reopen recent project → valid last mode/scene resumes; stale scene falls back safely.
5. Permanent delete confirmation → project disappears and backend purge assertions pass.

Use `MockLlmClient` only. Run `make test`, `make lint`, `make check-contract`, and `make e2e` for this UI/schema/import change. Prompt/tool-schema changes require explicit real-eval approval before merge.

## 13. Delivery slices

1. Contract + `GET /projects` + dashboard shell/list states.
2. Routing cleanup: remove seeded defaults; project-scoped resume behavior.
3. Shared wizard shell + format presets + browser-local drafts.
4. Idea path + foundation-aware atomic root creation.
5. Import path + upload/paste + atomic create-and-import + progress.
6. Guided Plan setup + reviewable scene-skeleton generation.
7. Full e2e/accessibility/privacy verification and authoritative doc updates.

Each slice is independently reviewable. Slice 6 is the only prompt-changing slice and cannot merge without the required eval sign-off.
