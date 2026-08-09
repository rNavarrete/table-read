"""Table Read API entrypoint."""

from fastapi import FastAPI

from errors import register_error_handlers
from import_diagnostics import configure_import_diagnostics_logging
from routes import change_sets_router, flags_router, ledger_router, router
from storage.db import Base, engine, ensure_storage_schema

# Idempotent; the real dev-DB population happens via `make seed`
# (storage/seed.py). Safe to call unconditionally on import — tests run
# against a throwaway DATABASE_URL set before this module is ever imported
# (see tests/conftest.py), so this never touches the dev DB in tests.
Base.metadata.create_all(bind=engine)
ensure_storage_schema()
configure_import_diagnostics_logging()

app = FastAPI(title="Table Read API")
register_error_handlers(app)
app.include_router(router)
app.include_router(ledger_router)
app.include_router(flags_router)
app.include_router(change_sets_router)


def _health_payload() -> dict[str, str]:
    # `llmMode` is how the app knows to tell the writer their analysis is
    # fixture data — see `llm.dependency.describe_client_mode`.
    from llm.dependency import describe_client_mode

    return {"status": "ok", "llmMode": describe_client_mode()}


@app.get("/health")
def health() -> dict[str, str]:
    return _health_payload()


# Same payload under the API prefix: the browser only proxies /api, so this is
# the one the app can actually reach.
@app.get("/api/v1/health")
def api_health() -> dict[str, str]:
    return _health_payload()
