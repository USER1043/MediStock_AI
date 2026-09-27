# ADR-0002: Stateless JWT auth with role claims

**Status:** Accepted

## Context

The API serves a separately hosted SPA (different origin). There are two roles (owner, staff), with per-route permissions. We want to run the API on simple hosting without a session store, and possibly more than one instance.

## Decision

On login, issue a **JWT** signed with `JWT_SECRET` (HS256), containing `id, username, email, role`, valid for `JWT_EXPIRE` (default 7 days). The client stores it and sends `Authorization: Bearer <token>`. `protect` verifies it; `authorize(...roles)` and `ownerOnly` check the `role` claim. Optional TOTP 2FA (speakeasy) sits in front of token issuance.

## Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| Server sessions + cookie (express-session with a Mongo/Redis store) | Instant revocation, but needs a shared store and CSRF protection, and cross-origin cookie setup between Vercel and the API host. |
| Third-party identity (Auth0, Firebase Auth, Cognito) | Less code to own, but adds cost and an external dependency, and is overkill for two roles in one shop. |
| Short-lived access token + refresh token | Better security posture; deferred for simplicity (see Consequences). |

## Consequences

- ✅ No session store; any API instance can verify any request; role checks need no database lookup.
- ✅ Simple to call from tools (curl, Postman) with a header.
- ⚠️ **No revocation before expiry**: logout, deactivation and role changes don't affect tokens already issued, and a 7-day lifetime widens that window.
- ⚠️ Stored in `localStorage` on the client, so it's exposed to XSS.
- ⚠️ The current 2FA flow issues a token from `{username, TOTP}` without proof that the password step succeeded. It needs a pre-auth token (see [security.md](../security.md)).
- Planned evolution: 15-minute access tokens, a rotating refresh token in an `httpOnly` cookie, and a `tokenVersion` on `User` for immediate revocation.
