"""Fountain I/O for Table Read (T1.3).

- ``export.to_fountain`` — walk scenes/beats → Fountain text.
- ``parse`` — the deterministic stage-1 split and the server-side line-range
  coverage validation (§7's "the LLM never controls text coverage" invariant);
  plus byte-identity ``reconstruct`` and §5 ``locate_source_text``.
- ``pipeline.run_import`` — the full import transaction (split → LLM
  segmentation → validation → ledger extraction → consistency scan → one
  snapshot committing doc + ledger + flags).

Parsing/serialization live here, apart from the route handlers, so the import
pipeline is a directly testable function and the route stays thin.
"""
