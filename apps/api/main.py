"""Table Read API entrypoint."""

from fastapi import FastAPI

from errors import register_error_handlers
from routes import change_sets_router, flags_router, ledger_router, router
from storage.db import Base, engine, ensure_storage_schema

# Idempotent; the real dev-DB population happens via `make seed`
# (storage/seed.py). Safe to call unconditionally on import — tests run
# against a throwaway DATABASE_URL set before this module is ever imported
# (see tests/conftest.py), so this never touches the dev DB in tests.
Base.metadata.create_all(bind=engine)
ensure_storage_schema()

app = FastAPI(title="Table Read API")
register_error_handlers(app)
app.include_router(router)
app.include_router(ledger_router)
app.include_router(flags_router)
app.include_router(change_sets_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
