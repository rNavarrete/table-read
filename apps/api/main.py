"""Table Read API entrypoint.

Endpoints beyond the health check land in later build-plan tasks (T1.x+),
once the contract package (T0.2) defines the wire schemas they must satisfy.
"""

from fastapi import FastAPI

app = FastAPI(title="Table Read API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
