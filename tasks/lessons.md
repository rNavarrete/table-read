# Lessons

## T2.1
- When asserting "character sheet X absent from bundle", assert on distinctive *sheet content* (e.g. Marta's hiding "Chicago firm"), NOT the character name — names also appear in the premise/theme text, so name-absence assertions give false failures.
- Contract grep gate forbids ANY `class Foo(BaseModel)` outside `apps/api/schemas.py` (not just op-output schemas). Use `Body(...)` params + dataclasses for request/DTO shapes in routes/modules.
- No OpenAPI snapshot gate exists yet (check_contract defers it), so new routes don't break check-contract.
