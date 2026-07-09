"""Error envelope (data contract §4): `{error: {code, message, details?}}`."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """Raise from a route to produce the contract's error envelope."""

    def __init__(
        self, status_code: int, code: str, message: str, details: dict | None = None
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        body: dict = {"code": exc.code, "message": exc.message}
        if exc.details is not None:
            body["details"] = exc.details
        return JSONResponse(status_code=exc.status_code, content={"error": body})

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Map FastAPI's default 422 (which uses a `{detail: [...]}` shape) onto
        # the contract's error envelope (§4) so *every* endpoint, including the
        # body-accepting POST/PATCH, speaks the same error shape.
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION",
                    "message": "request failed validation",
                    "details": {"errors": jsonable_encoder(exc.errors())},
                }
            },
        )
