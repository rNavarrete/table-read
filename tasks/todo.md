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
- [ ] make test, make lint, make check-contract green
</content>
