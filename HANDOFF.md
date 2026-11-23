# Podium: production handoff

Podium is a site of skill games with weekly prize pools, one-on-one duels, daily missions and a cosmetics shop. This document tells you how to turn the approved prototype into a live product.

- **Prototype (source of truth for look, copy and game feel):** `prototype/podium-v9.html`. One self-contained file. Open it in a browser and play every game before writing code.
- **Brand name:** "Podium" is a working name. It lives in one `BRAND` constant; keep it that way in production so it can be renamed in one place.
- **Currency in this phase:** tChips, test chips with no value. No real token, deposit, withdrawal or payout is in scope. See "Scope and gates".

## 1. Scope and gates

Build and deploy in three phases. Only Phase 0 and Phase 1 are authorised now.

| Phase | What ships | Status |
|---|---|---|
| 0 | The prototype file served as a static site, so there is a live URL today | Do now |
| 1 | Real accounts, server-side balances, real leaderboards, duels between real players, all in tChips | Do now |
| 2 | Server-side score validation by input replay, anti-abuse | Do after Phase 1 is stable |
| 3 | Real token: on-chain pools, duel escrow, burn, deposits and withdrawals | **Blocked** until the owner confirms a written legal opinion per country |

Rules that hold in every phase:

- The server owns every balance, score, reward and item. The browser is a display.
- tChips can never be bought, sold, redeemed or converted. Say so in the Rules page, as the prototype does.
- Do not add any payment, wallet-signing or token-transfer code before Phase 3 is unblocked. Wallet sign-in for identity only is fine.
- Age gate at 18 on sign-up.

## 2. Stack and hosting

Use the owner's standard production stack.

- **Web:** Next.js 14 (App Router), TypeScript, in `apps/web`.
- **API:** Fastify, TypeScript, in `apps/api`. REST plus one WebSocket endpoint for live runs.
- **Database:** PostgreSQL through Prisma. A starting schema is in `docs/schema.prisma`.
- **Cache and queues:** Redis. Leaderboards as sorted sets, rate limits, session store, weekly-close job lock.
- **Shared code:** `packages/games` (deterministic game logic used by both browser and server) and `packages/shared` (constants, types).
- **Hosting:** Hostinger VPS, Nginx in front, PM2 for processes. Templates in `deploy/`.
- **Package manager:** pnpm workspaces.

Repo layout:

```
apps/web            Next.js site
apps/api            Fastify API + WebSocket + jobs
packages/games      game logic, pure TypeScript, no DOM
packages/shared     constants (economy, missions, season), types
prototype/          podium-v9.html, kept for reference
deploy/             nginx and pm2 templates
docs/               schema and notes
```

## 3. What the prototype contains

### Pages

| Page | Contents |
|---|---|
| Games (home) | Daily streak, today's three missions, hero game (largest pool), weekly Cup banner, six Featured cards, six Classics |
| Duels | Pick a game and a stake, get matched, play one run, history |
| Leaderboard | Per-game weekly board with pool, payout and fee, avatars |
| Shop | Mystery box, six premium avatars, four frames, burn counter |
| Profile | Level ring, stats, name, avatar and frame pickers, mystery boxes, Season track, invite link |
| Rules | Plain-language rules |
| Build notes | Developer notes; remove from the public site |

Overlays: pre-game sheet with controls, in-game stage (HUD, countdown, pause, result), share card, challenge sheet, welcome modal, box reveal, notifications panel.

### Games

All thirteen run on a 480 by 640 logical canvas. Scores are integers, higher is better.

| Key | Name | Type | Controls | Score |
|---|---|---|---|---|
| hopper | Road Hopper | 3D, featured | Up or Space forward, Left and Right sidestep | Furthest row reached |
| blaster | Star Blaster | 2D, featured | Left and Right or drag, auto-fire | Kills times combo multiplier (to 8x); boss every 5th wave; S, R, H power-ups; 3 lives |
| breaker | Brick Breaker | 2D, featured | Left and Right or drag | 10 per brick times combo, plus 100 times level on clear; W, M, S, L capsules; 3 lives |
| traffic | Traffic Rush | 3D, featured | Left and Right change lane | Distance divided by 4 |
| cube | Cube Field | 3D, featured | Left and Right steer | Distance divided by 3 |
| blade | Blade Rush | 2D, featured | Left and Right strike | 1 per kill plus combo bonus; a miss locks you for 0.42 s |
| stack | Stack Tower | 2D, featured | Space or tap to drop | Floors stacked; a perfect drop keeps full width |
| duck | Duck Dash | 2D, classic | Left and Right or drag | Time times 10, plus 15 per coin |
| glide | Storm Glide | 2D, classic | Space or tap to climb | 1 per gate, plus 2 per star |
| hop | Sky Hop | 2D, classic | Left and Right or drag | Height divided by 10 |
| snake | Snake Turn | 2D, classic | Left turns left, Right turns right | Food eaten |
| sprint | Night Sprint | 2D, classic | Space or tap, double jump | Distance divided by 20, plus 10 per coin |
| hoop | Hoop Shot | 2D, classic | Space or tap to shoot | Baskets; three misses end the run |

The exact constants (speeds, spawn rates, hit boxes) are in the `DEF` object in the prototype. Port them unchanged first; tune later.

### In-game flow

Enter (charge the entry) → 3-2-1 countdown → play → death (shake and flash, 0.7 s) → result screen. Pause with the button, Esc or P, and automatically when the tab loses focus. Result shows score, badges, a line about what the score means, top five, XP bar, Play again and Share.

## 4. Economy constants

Put these in `packages/shared/economy.ts`. They are the prototype's values.

| Item | Value |
|---|---|
| Starting balance | 2,000 tChips |
| Refill | Back to 500 when under 100 |
| Ranked entry | 100, all of it into that game's weekly pool |
| Practice entry | 10, not recorded; first 3 practice runs are free |
| Cup entry | 250, into the Cup pool |
| Platform fee | 6% of any pool or duel pot |
| Weekly split | 50 / 30 / 20 to the top three |
| Cup split | 40 / 25 / 15 / 12 / 8 to the top five |
| Duel stakes | 50, 100, 250, 500; winner receives stake × 2 × 0.94 |
| Shop burn | 10% of each purchase |
| Mystery box drop | 5% chance per ranked or Cup run |
| Mystery box price | 300 |
| Premium avatars | Crown 900, Visor 900, Halo 1,200, Wizard 1,500, Headphones 1,500, Astronaut 2,500 |
| Frames | Mint 500, Pink 500, Aurora 2,000, Fire 2,000 |

**Mystery box contents:** 16% a cosmetic the player does not own (falls through to the next tier if none is left), 26% XP between 80 and 200, 58% tChips between 100 and 400.

**XP:** ranked run of 10 s or more 40; Cup run of 10 s or more 60; new personal best +60; duel win 50, loss 10; friend challenge win 80, loss 15; top-three finish at weekly close +150. Level = floor(sqrt(XP / 100)) + 1.

**Daily streak:** 100, 150, 200, 250, 300, 400, then 600 plus a mystery box on day 7, repeating. Missing a day resets to day 1.

**Daily missions:** three per day chosen from six by day number (indices d, d+2, d+4 modulo 6). Clearing all three adds a mystery box.

| Mission | Target | tChips | XP |
|---|---|---|---|
| Play 3 ranked runs | 3 | 150 | 40 |
| Play 2 different games | 2 | 120 | 40 |
| Set a new personal best | 1 | 200 | 60 |
| Win a duel | 1 | 200 | 60 |
| Survive 45 seconds in one run | 1 | 150 | 50 |
| Finish 5 runs of any kind | 5 | 100 | 30 |

**Season 1 track (by total XP):** 200 → 150 tChips; 400 → box; 700 → 250 tChips; 1,000 → Mint frame; 1,400 → 400 tChips; 1,800 → box; 2,300 → 600 tChips; 2,800 → Visor avatar; 3,400 → 800 tChips; 4,000 → Aurora frame. An already-owned cosmetic pays 300 tChips instead.

**Weekly Cup:** one game per week, rotating through blaster, hopper, breaker, traffic, cube. Runs Monday 00:00 UTC to the next Monday.

**Weekly boards:** Friday 00:00 UTC to the next Friday. Best score per player counts; a tie goes to the earlier score.

**Emissions:** mission, streak, season and box rewards must come from a capped daily budget funded by fees, never minted on demand. Add the budget and a scale-down rule in Phase 1 even though tChips have no value, so the logic is proven before Phase 3.

## 5. Phase 0: static deploy

1. Copy `prototype/podium-v9.html` to the web root as `index.html`.
2. Serve it with the static Nginx server block in `deploy/nginx.conf` (the `podium-static` block).
3. Issue a certificate with certbot and redirect HTTP to HTTPS.
4. Check on a phone: games load, touch pad appears, share card downloads, a challenge link (`?c=duck.300.Name&ref=code`) opens the challenge sheet.

This gives a public URL the same day. It is still the browser-only prototype: scores are local and can be edited by anyone. Say "Prototype" on it.

## 6. Phase 1: accounts and a real backend

### Port the UI

- Rebuild the pages as Next.js routes: `/`, `/duels`, `/leaderboard`, `/shop`, `/profile`, `/rules`, `/play/[game]`.
- Keep the visual design exactly: fonts (Bricolage Grotesque for display, Instrument Sans for text), the light theme tokens in `:root`, card and button shapes, the dark immersive in-game stage. Lift CSS from the prototype rather than restyling.
- Cover art is generated by the `ART` functions in the prototype. Run them once at build time and save each cover as an SVG file in `apps/web/public/covers/`.
- The share card is drawn on a canvas in the browser. Keep that, and also add an Open Graph image route so shared links preview on X and Telegram.

### Port the games

- Move each game from the prototype's `DEF` object into `packages/games/<key>.ts` exporting `init(seed)`, `update(state, input, dt)` and `draw(ctx, state)`. `init` and `update` must not touch the DOM.
- Replace every `Math.random()` inside game logic with a seeded generator passed in the state (mulberry32 is enough). Visual-only randomness (particles, screen shake) may stay unseeded.
- Run logic at a fixed 60 Hz step with an accumulator. The prototype uses variable `dt`; that must go.
- The three 3D games use Three.js r128. Keep rendering in the browser; their logic (`update`) still lives in `packages/games` and stays pure.

### Auth

- Email one-time code, Google, and wallet signature (identity only). Guests can play practice; signing in keeps their progress.
- Display names: 3 to 16 characters from letters, digits, space, underscore, dot, hyphen; unique; cannot start with "Guest" or "Player".

### API (Fastify)

All routes under `/api`. Session cookie, CSRF protection on mutations, rate limits in Redis.

| Method and path | Purpose |
|---|---|
| POST `/auth/*` | Sign-in flows |
| GET `/me` | Balance, XP, level, items, streak, missions, season, notifications |
| PATCH `/me` | Name, avatar, frame |
| POST `/refill` | Refill rule above |
| GET `/games` | Game list with pools and top three |
| POST `/runs` | Start a run: body `{game, mode, duelId?, cup?}`. Charges the entry, returns `{runId, seed}` |
| WS `/runs/:id/stream` | Phase 2: input stream |
| POST `/runs/:id/finish` | Phase 1: body `{score, inputLog}`. Stores the log, applies sanity limits, records the score |
| GET `/leaderboard/:game` | Weekly board, pool, payout table |
| GET `/cup` | Current Cup |
| POST `/duels` | Create or join a duel `{game, stake}` |
| GET `/duels` | History and open duel |
| POST `/challenges` | Create a friend challenge from a run; returns a short code |
| GET `/challenges/:code` | Read a challenge |
| POST `/missions/:id/claim`, `/streak/claim`, `/season/:tier/claim` | Rewards |
| POST `/boxes/open`, `/shop/buy` | Boxes and shop |
| GET `/notifications`, POST `/notifications/read` | Inbox |

### Behaviour that changes from the prototype

- **Leaderboards hold real players.** Seed each board with nothing; do not ship the generated rival names. Pools start at zero each week.
- **Duels are between real players.** A player creates a duel and plays their run; the next player to pick the same game and stake plays against that stored score. Refund the stake if nobody joins within 24 hours.
- **"Passed you" notifications** fire when a real player overtakes you.
- **Friend challenges** use a short server code instead of putting the score in the URL.
- **Referral:** the invited player gets 300 tChips on sign-up. The inviter gets 300 after the invited player completes three ranked runs. Cap inviter rewards at ten per week.
- **Weekly close job:** a scheduled job closes each board and the Cup, pays the split, records the fee, and opens the next period. It must be idempotent and take a Redis lock.
- **Activity ticker** shows real recent events.

### Phase 1 score checks

Replay validation arrives in Phase 2. Until then, on `finish`:

- Reject a score that is impossible for the run's duration (for each game, a maximum score per second; derive from the constants).
- Reject a finish that arrives sooner than the run could have lasted, or later than the session allows.
- Store the input log with every run so Phase 2 can replay history.
- Mark boards "beta" in the UI.

### Acceptance for Phase 1

- A new player can sign up, play all thirteen games on desktop and phone, and see their score on a board that another account can also see.
- Two accounts can complete a duel; the winner's balance rises by stake × 2 × 0.94 and the loser's falls by the stake.
- Missions, streak, season, boxes, shop and refill all change the server balance, and replaying a request does not pay twice.
- The weekly close pays the right amounts in a test with three accounts, and running it twice changes nothing the second time.
- Lighthouse performance 85 or better on the home page on mobile.
- No secret is in the repo. `.env.example` lists every variable.

## 7. Phase 2: replay validation and anti-abuse

- The browser streams inputs (frame number and key) over the WebSocket at least every two seconds. A run that falls behind real time or stops streaming is ended.
- On finish, the server replays `packages/games` with the run's seed and inputs and uses its own score. The client score is ignored.
- Limit inputs per second per game. Flag runs with machine-regular timing; hold their rewards for review and keep the replay.
- A game's rules are versioned. Changing a game adds a version; existing runs replay on the version they were played on.
- Reward gating: mission, streak and referral rewards require an account that has completed a minimum number of validated ranked runs.
- Rate-limit by device fingerprint and IP; review account clusters.

## 8. Phase 3: token (blocked)

Do not start. Recorded here so the earlier phases are built to fit it.

- Pool escrow contract: one pool per game per period; entries in; the close pays the split and the fee.
- Duel escrow: both stakes locked at match, released on validated result, refunded on failure or timeout.
- Entry, fee and split for a game are fixed when it is listed.
- Shop burn happens on-chain.
- Reward tokens vest: usable in games at once, withdrawable after a delay.
- Country blocking and the legal opinion come first.

## 9. Deploy on the VPS

Templates are in `deploy/`. Replace `<DOMAIN>` and paths.

1. Node 20 LTS, pnpm, PostgreSQL 15 or later, Redis 7, Nginx, PM2, certbot.
2. Create the database and a dedicated user. Run `pnpm prisma migrate deploy`.
3. `pnpm build`, then `pm2 start deploy/ecosystem.config.js` and `pm2 save`.
4. Install the Nginx server block, test with `nginx -t`, reload, then run certbot.
5. Firewall: open 80 and 443 only. PostgreSQL and Redis listen on localhost.
6. Nightly `pg_dump` to off-server storage. Test a restore once.
7. Health endpoint `/api/health`; an uptime check that alerts on failure.

Environment variables are listed in `.env.example` (create it): `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_SMTP_URL`, `PUBLIC_URL`, `BRAND_NAME`.

## 10. What the owner must supply

- The domain name and DNS access.
- SSH access to the VPS.
- The final brand name, or confirmation that "Podium" stays.
- Google OAuth credentials and an SMTP account for sign-in codes.
- For Phase 3 only: the token details and the legal opinion.

## 11. Known gaps in the prototype

- No human has play-tested difficulty. Expect to tune speeds and spawn rates after the first real sessions.
- Sound and music are generated with WebAudio and were never heard during development. Check volume and mute on real devices.
- Touch controls were checked in a narrow desktop window, not on a phone.
- The "Post on X" and copy-link buttons need a hosted URL to be meaningful.
- Six Classics still use simpler in-game art than the seven Featured games.
