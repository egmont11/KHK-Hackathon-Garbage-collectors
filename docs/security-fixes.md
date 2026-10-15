# Security audit follow-up

This PR follows the 2026-10-15 audit of `87a8710` and applies the fixes to the newer `main` baseline `473239b`, which already added password-based player accounts and Compose deployment. The agreed scope preserves the hackathon API and gameplay. It mitigates GPS spoofing and fake identities rather than claiming that a browser can prove physical presence or a unique human.

| Finding | Change / status |
|---|---|
| F01 | Dashboard ignores `?api`; credentials use same-origin paths and CSP `connect-src 'self'`. |
| F02 | Vite 6.4.4 and compatible plugins; locked installs; loopback-only development defaults, CORS disabled and default Host validation retained. All frontend advisories disappear from `npm audit`. |
| F03 | Admin sessions bind to the verified password hash. Login rechecks current state after hashing; every protected request rejects an old hash or a deleted account. |
| F04 | Clickable demo always uses isolated browser mock/storage. Production builds ignore demo query parameters unless explicitly built as a demo. Backend demo cannot use PostgreSQL or production mode. Production rejects shortened game rules. **Direct GPS spoofing remains possible; see limitations.** |
| F05 | Existing password accounts are preserved. Registration has per-IP limits, a total account cap, NFC name normalization and protection against concurrent duplicate-name registration. **Multiple humans/accounts cannot be proven unique without a new identity system.** |
| F06 | Bounded request/registration/check-in limits; total account cap also enforced inside a database lock; at most 16 in-flight scrypt jobs; reuse timezone formatter/round calculations; abandoned database check-ins and cascading pings are removed. No claim of protection against distributed DDoS. |
| F07 | Login attempts are reserved synchronously before hashing, keyed by IP and normalized username; parallel requests no longer bypass the five-attempt limit. Same fix applies to player login added on main. |
| F08 | Random 256-bit player tokens, SHA-256 digests in DB/RAM, expiry (default 168 hours), rotation on login, server-side logout. Legacy plaintext tokens are invalidated during migration; scores and identities stay. |
| F09 | Public detail retains `last_visited_at: null` for interface compatibility; exact timestamps remain private to player profile and administration. Public team aggregate polling remains an intentional game feature. |
| C01 | Tooltip uses `textContent`, including labels read back from HTML attributes. Hash-based dashboard CSP blocks inline injected handlers as another layer. |
| C02 | PostgreSQL-backed admin lookup and authorization read current account/hash, so another store's deletion/password change invalidates the old session. Game state itself still assumes one serving backend process. |
| C03 | Compose requires explicit secrets and a public hostname; Caddy terminates HTTPS and redirects HTTP. Production backend requires HTTPS and only trusts the configured Caddy IP. Frontend production API configuration rejects insecure remote HTTP. |
| C04 | Login limits use IP + account instead of blocking all accounts on one IP. Proxy trust is explicit; no global acceptance of spoofed forwarding headers. NAT clients targeting the same account still share its limit. |
| C05 | CSV neutralizes formula prefixes and whitespace/control-character variants before escaping delimiters, quotes and line breaks. |
| C06 | CSP, `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff and no-referrer. Administrative/API responses are not cached. |
| C07 | No generated bootstrap secret in logs. Local development stores it in an ignored 0600 file; production requires an explicit strong secret. Docker excludes credential files. |
| C08 | Initial passwords always pass the same policy as new admin passwords. Insecure `admin/admin` bootstrap defaults removed; an existing legacy `admin/admin` account stops production startup until deliberately reset. |

## Deployment and migration

1. Set `.env` with a real public `SITE_ADDRESS`, strong `POSTGRES_PASSWORD` and strong `ADMIN_PASSWORD`. Do not use example placeholders. Caddy needs public DNS and ports 80/443 to obtain its certificate; its certificate data persists in volumes.
2. For an old deployment using `admin/admin`, set `ADMIN_RESET=1` once to reset that administrator to the configured strong password, then remove that reset setting. The first login must change the password.
3. Existing player sessions expire during schema migration. Password-based player accounts sign in again; scores, check-ins and season history are kept. Legacy accounts without a password require an explicit operator recovery decision, not automatic takeover by claiming their name.
4. A login now rotates the player's token; another device/session is logged out. Frontend logout calls the API before deleting local credentials. An offline logout reports failure so it does not silently claim server revocation.
5. Compose now exposes HTTPS on 443 (HTTP 80 redirects) instead of an HTTP-only port 8080. Custom reverse-proxy hosting must preserve TLS to Caddy and adjust ports/routing. Backend forwarding trust is only `172.30.57.10`; keep it aligned with the fixed Caddy address in Compose. Choose a different private subnet/address if this subnet is already used.
6. A separate development origin requires an explicit `CORS_ORIGINS` allowlist. Default Vite access is loopback; use an explicit `--host` only on a trusted network. HTTPS development uses the existing optional SSL plugin.

## Remaining boundaries agreed with the user

- A client still controls its GPS coordinates and reported accuracy. The public catalogue necessarily contains POI coordinates. The API cannot distinguish a real browser fix from a scripted request. Strong presence verification would require an additional trusted mechanism and a changed game flow (for example an independently verified on-site challenge). Rate limits and demo isolation reduce abuse but do not solve that trust problem.
- Password accounts and registration limits do not guarantee one person per account. A determined attacker can use different names/IPs. External identity verification is outside this PR by explicit scope choice.
- Public leaderboard/territory aggregates intentionally update after visits and can be compared over time. Removing the precise public timestamp reduces disclosure; it cannot make all public aggregate changes unobservable.
- Limits are local to each process. The existing in-memory game/season state is not coherent across backend replicas; operate one serving game backend. Cross-instance credential revocation is tested, but this PR does not introduce distributed rate limiting or a distributed game engine.
- The 10,000-player cap bounds account/index memory; historical legitimate visits remain available and can still grow over the application's lifetime. Retention/archive policy for long-term analytics remains an operational decision.

## Verification

- Backend TypeScript check, existing end-to-end gameplay smoke test; 10 backend security tests and 2 frontend security tests.
- Backend security suite: old-password race; SQL migration idempotence and legacy-token invalidation; token digest, expiry and cross-store revocation; admin password/delete propagation; abandoned-check-in cleanup; concurrent login limits and duplicate registration; capacity limit; HTTPS/trusted-proxy handling; private bootstrap file; weak bootstrap and unsafe demo refusal; CSV; dashboard fetch target, CSP script hash and tooltip text.
- SQL integration uses PGlite (PostgreSQL compiled to WASM), running the actual schema and queries. It is not a substitute for a live multi-connection PostgreSQL/Compose integration test; transactional concurrency is implemented using PostgreSQL table/row locks but not stress-tested by that harness.
- Frontend security suite executes demo-mode selection across five configurations and starts the actual Vite server to verify the original `?import&raw??` file-read vector returns 403, hostile-origin responses lack CORS access and unknown Host names are rejected.
- Frontend production/PWA build; both `npm audit --json --ignore-scripts`; whitespace/diff checks.
- Native browser verification was attempted but the browser tool timed out. No successful new browser end-to-end result is claimed; HTTP, SQL and script behavior tests provide the regression evidence.
- Docker Engine and a public TLS domain were unavailable here, so full container startup / certificate issuance was not exercised. Compose YAML and proxy address consistency are parsed locally. The PR workflow validates Compose and Caddy using Docker; Caddy CLI validation was unavailable locally.

Changes are delivered for review in a feature branch and PR only. This work does not merge or deploy them.
