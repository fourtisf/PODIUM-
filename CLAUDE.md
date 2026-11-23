# Project rules for Claude Code

Read `HANDOFF.md` in full before changing anything. It is the specification. This file is the short list of rules that must hold in every session.

## What this project is

Podium: skill games with weekly prize pools, duels, missions and a shop. The approved design is `prototype/podium-v9.html`. Production is a pnpm monorepo: Next.js 14 (`apps/web`), Fastify (`apps/api`), Prisma with PostgreSQL, Redis, deployed on a Hostinger VPS behind Nginx with PM2.

## Hard rules

1. **Test chips only.** The currency is tChips and has no value. Do not write any deposit, withdrawal, payment, token-transfer or on-chain payout code. Phase 3 in `HANDOFF.md` is blocked until the owner says in writing that it is unblocked. If a task seems to need it, stop and ask.
2. **The server is the authority.** Balances, scores, rewards, items and leaderboards are computed and stored on the server. Never trust a value the browser sends for any of them.
3. **Money-like operations are idempotent.** Entry charges, payouts, claims and purchases run in a database transaction and carry an idempotency key. Replaying a request must not pay or charge twice.
4. **Keep the design.** Match the prototype's layout, type, colours, copy and in-game flow. Lift CSS and game constants from it. Do not restyle or rewrite copy unless asked.
5. **Game logic is pure and deterministic.** Everything in `packages/games` runs in both the browser and Node, takes a seed, uses a fixed 60 Hz step, and never touches the DOM, `Date.now()` or `Math.random()`.
6. **No generated players in production.** The prototype's rival names, duel opponents and Cup entrants are placeholders. Boards start empty.
7. **Secrets stay out of the repo.** Use environment variables and keep `.env.example` current.
8. **Constants live in one place.** Economy numbers, missions, season tiers and the brand name come from `packages/shared`. Do not hard-code them in components or routes.

## Working order

1. Phase 0: serve the prototype as a static site (see `HANDOFF.md` section 5).
2. Phase 1: accounts, API, database, real leaderboards and duels (section 6). Work through the acceptance list at the end of that section and report against it.
3. Phase 2 only when asked.

## Conventions

- TypeScript strict mode everywhere.
- Prisma migrations for every schema change; never edit the database by hand.
- One test file per API route covering the happy path, an unauthorised call, and a replayed request.
- Unit tests for each game: the same seed and inputs must give the same score on every run.
- Before saying a task is done, run the type check, the tests and a production build, and say which of them you ran.

## When unsure

Ask before: changing an economy number, removing a game, adding a third-party service, or doing anything that touches real value. For everything else, follow the prototype.
