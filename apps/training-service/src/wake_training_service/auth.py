"""Static-token auth for mutating endpoints (ADR-036 5)."""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException


class Auth:
    """If a token is set, mutating endpoints require it (Bearer or X-API-Key).

    If no token is configured the service is open (localhost dev default);
    the Colab launcher ALWAYS sets one (--token / WAKE_SERVICE_TOKEN).
    """

    def __init__(self, token: str | None = None) -> None:
        self.token = token

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    def require(self):
        def dep(
            authorization: str | None = Header(default=None),
            x_api_key: str | None = Header(default=None),
        ) -> None:
            if not self.enabled:
                return
            provided = None
            if authorization and authorization.lower().startswith("bearer "):
                provided = authorization[7:].strip()
            elif x_api_key:
                provided = x_api_key.strip()
            if not provided or not secrets.compare_digest(provided, self.token or ""):
                raise HTTPException(status_code=401, detail="invalid or missing token")
        return dep
