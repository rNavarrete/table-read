# T2.2 — Accept / Tune / Skip + ledger hook

Branch: sdd/mvp. Skip is client-side (no server work).

## Plan (TDD; lock-violation test FIRST — rule 2)

### Commit 1 — lock-safe beat insert (write-side) + lock-violation test
- [ ] `drama_manager/locks.py`: `LockViolation`, `insert_beat` — insert + reindex, reject locked scene/episode, guard locked-beat content byte-identical
- [ ] `tests/test_accept_locks.py` — lock-violation tests (content byte-identical, reject locked scene/episode)

### Commit 2 — accept pipeline + ledger policy + route
- [ ] `drama_manager/ledger_policy.py` — confidence gate, strict sourceText verify, supersede proposals, id minting (pure)
- [ ] `drama_manager/accept.py` — run_accept: insert → extract → policy → scan → one mutate
- [ ] `routes.py` — POST /projects/{pid}/scenes/{sid}/beats
- [ ] `tests/test_ledger_policy.py` (unit), `tests/test_accept.py` (route + pipeline)

### Commit 3 — tune endpoint (SSE, one candidate)
- [ ] `render.build_tune_prompt` (+ bump PROMPT_VERSION → 0.3.0, rule 7 make-evals note)
- [ ] `llm`: `stream_tune_beat` on protocol + mock + anthropic client
- [ ] `candidates.py`: parametrize stream helpers; `build_tune_bundle`, `generate_tune_events`
- [ ] `routes.py` — POST /projects/{pid}/scenes/{sid}/candidates/tune
- [ ] `tests/test_tune.py`

## Key decisions
- Extract/scan failure BLOCKS accept (atomic, nothing persisted) — grounded in obligation 1 (one snapshot for beat+facts+flags) + import transaction precedent (§4) + rule 9 (no fabricated fallback).
- Confidence <0.8 → pending_review, else active (§5); import stays all-pending (unchanged).
- sourceText verify is STRICT window-only for accept (demote on miss); parse.locate_source_text (lenient, whole-beat fallback) stays for import.
- Supersede proposal = new pending_review/inferred fact, supersedes=targetId, original untouched (§5/§4).
- Beat `index` is structural (reindexed freely); lock protects CONTENT fields only.

## Verify
- [x] make test (496 API + 6 web + 4 contract), make lint, make check-contract — all green

## Review (done)
- All plan items complete across 3 commits; lock-violation test committed first (e77ffb2) before the accept feature (e056796) — rule 2 ordering.
- 41 new backend tests: 7 lock, 12 ledger-policy (unit), 22 accept (route + pipeline + fault injection), 8 tune. No deps added.
- Self-review: locked content byte-identical after accept (proven at insert + route level); one snapshot for beat+facts+flags with fault-injection rollback; fact-07 original untouched + proposal via supersedes chain; sourceText strict window verify with exact offset reproduction + demotion on miss; no writer text logged; MockLlmClient only.
- Concerns (see task-T2.2-report.md): PROMPT_VERSION 0.3.0 needs make evals sign-off (rule 7); documented interpretation decisions (locked scene rejects insertion; locked-beat reindex allowed; supersede null-replacement carries target text; newFacts excludes proposals).
</content>
