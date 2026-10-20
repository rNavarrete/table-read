# Breakdown ledgers, P2 (T10.8–T10.10) — design

Status: owner directive 2026-10-19 ("lets start on the P2 items"), after P0 (T10.1–T10.2) and P1 (T10.3–T10.7) merged. The owner did not take design questions; every _(call)_ is the builder's default for the owner to check in review.

## Why

The 2026-10-19 screenplay-breakdown research's P2 rows:

- **Exposition is a process, and its craft tests are checkable.** Sternberg/Bordwell treat exposition as distributed across a film and ask when a fact arrives against when it is needed. The working tests are per line: who tells whom and why (Mazin's relationship test, Scriptnotes 357), "As you know, Bob", McKee's ammunition vs table dusting, Wilder's "let the audience add up two plus two". The ledger already holds the units: every fact has a delivering scene, verbatim `sourceText`, `knownBy` and knowledge events.
- **Some beats carry the story and some decorate it.** Chatman's kernels "cannot be deleted without destroying the narrative logic"; satellites are "always logically expendable". McKee: true character is revealed in a choice made under pressure.
- **A breakdown researchers can take away.** Story Grid's spreadsheet (one row per scene: event, value shift, polarity, turning point, characters) is the only scene-level analytic schema in use, and it is filled by hand. Export the import's breakdown in that shape.

## Not in P2 _(calls)_

- **Per-show calibration of fixed thresholds.** The two named thresholds are the segmentation soft gate (an eval threshold, DESIGN-GAP(T6.1) — evals are on hold) and the short-establishing-scene exemption (DESIGN-GAP(T9.16), awaiting the owner's numbers). A per-script percentile would exempt real scenes in tightly cut scripts; confirming T9.16's numbers is the cheaper fix.
- **Publishing agreement metrics against human annotation.** Needs an annotated TV corpus and the evals redesign. T10.10's export is the annotation template a corpus would start from.

Invariants carried from P0/P1: evidence-first, every new field defaulted (old docs, checkpoints and responses load), counts-only logs, one snapshot per import, read-only display, tokens only, findings stated, never graded.

## T10.8 Exposition audit (`extract_ledger_facts`)

**Contract.** `ExtractedFact` and `LedgerFact` add:
- `delivery`: `'stated' | 'shown' | 'implied' | null`, default `null` — how the audience gets the fact: said outright (dialogue, voice-over, an insert or super), shown in picture without being said, or left for the audience to put together (two plus two).
- `neededBySceneId`: `Id | null`, default `null` — the first scene whose events depend on the audience knowing this fact (it can be earlier than the delivering scene: a mystery the script answers later).

**Server.** `neededBySceneId` must name a scene of this episode, else `null` (count). Nothing else is new on the server _(call: everything below is a projection over data the import already stores)_.

**Derived (client, no request).** For a fact, from its source lines in the delivering beat (`sourceSpan`, the beat's `scriptText`, the existing Fountain line classifier):
- **Mode**: dialogue (with the speaker from the cue above; voice-over / off-screen from the cue's extension), action, or an insert/super ("ON SCREEN:", "SUPER:", "INSERT").
- **Gap**: scenes between delivery and need, in board order — "arrives 4 scenes before it's needed", "arrives in the scene that needs it", "needed 3 scenes before it arrives" (delayed exposition).
- **Flags**, stated as observations:
  - "As you know" — the source lines match a short list of told-you-so phrases ("as you know", "as you're aware", "like I told you", "as I said", "you already know") _(call: a fixed list in one place, case-insensitive)_.
  - "Told to someone who already knew" — delivered in dialogue, and every present knower other than the speaker already knew it before this scene (the existing as-of fold): the line is there for the audience.

**Prompt.** For each fact, how the audience receives it (stated / shown / implied, with one-line definitions; "implied" only when the scene never says it outright) and the first scene whose events need the audience to know it, from the scene list, or null.

**UI.** Plan scene panel "What it touches", each fact established here: one line under it — "Said by Dan to Marta · stated · needed in scene 7" (mode, delivery, gap) and the flags, when present. Ledger: the fact card and detail show the same line; the filter rail gains an **Exposition** lens that keeps facts with a delivery and orders them by delivering scene, if the rail's lens model fits it; if not, leave a `DESIGN-GAP(T10.8)` and only the fact card line _(call)_.

## T10.9 Kernels and choices (`segment_scene`)

**Contract.** Each beat segment in `SegmentedScene` adds `kernel` and `pressureChoice` (boolean, default `false` in the model output). `Beat` adds `kernel` and `pressureChoice` (boolean \| null, default `null` = not read; import writes the model's booleans) _(call: null keeps authored and pre-change beats distinct from "read as satellite")_.

**Server.** Carry both through `parse.py` like P0's beat fields (synthetic and absorbed beats get `null`); segment checkpoints round-trip them; old checkpoints load `null`.

**Prompt.** Using the whole episode (already the cached prefix): `kernel` — removing this beat would break the story's logic (it opens, turns or closes a consequential line); a beat that only elaborates, colours or repeats is not a kernel. `pressureChoice` — a character makes a real choice here, with something at stake and a cost either way; a reaction, a reflex or a decision with nothing at risk is not one.

**UI.** Plan beat ladder: a row shows "kernel" and/or "choice" tags (muted text, tokens only) when true; an opened row says it in a sentence ("Load-bearing: the story breaks without it." / "A choice under pressure."). Nothing when `null` or `false`.

## T10.10 Breakdown export

**API.** `GET /projects/{pid}/export.breakdown.csv` (`text/csv`, `Content-Disposition` attachment named from the project title). One header row, then one row per scene of the first episode in board order (act, then index) _(call: the episode the rest of the app shows)_. Built with the stdlib `csv` module. No LLM call, no mutation, no snapshot.

**Columns** _(call: Story Grid's columns plus the ledgers P0/P1 added)_, empty cell when a value is absent: `Scene` (number in board order) · `Act` (the act label, TAG and COLD OPEN included) · `Storyline` · `Location` · `Time` · `What happens` · `Value at stake` · `Charge in` · `Charge out` · `Turns` (yes / no / empty when either charge is missing) · `Why now` · `Story order` (rank + 1) · `Story time` · `Anachrony` · `Beats` (count) · `Kernel beats` · `Choices` · `Wants` (Name: objective; …) · `Threads set up` · `Threads paid off` · `Threads moving` (label (phase); …) · `Secrets` (summary (set/kept/out); …) · `Facts established` (count) · `Characters` (cue and motivation names). Fields from T10.8/T10.9 are read with defaults so the export works before or after they land.

**UI.** The top bar's Export becomes a small menu: **Fountain script** (today's behaviour) and **Breakdown spreadsheet (.csv)**. Same enable/disable rule as today.

## Tests

Each task: contract defaults and round-trips, `check_contract` with any regenerated tool schema, `MockLlmClient` returns the new fields, pytest for every server rule, Vitest for every UI line, counts-only logs, `check_design_gaps`. T10.10: pytest on the CSV (header, board order, a tag and cold-open label, quoting of commas/newlines/quotes, missing fields empty, a project with no episode → header only, 404 for an unknown project), Vitest for the menu.

## Sign-off

T10.8 and T10.9 bump `PROMPT_VERSION` from main's current value (each later merge renumbers); `make evals` is on hold, each PR asks for the substitute sign-off. T10.10 changes no prompt.
