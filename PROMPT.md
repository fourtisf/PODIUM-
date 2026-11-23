# Prompts to paste into Claude Code

Put this whole folder in an empty project directory, open Claude Code there, and paste the prompts one at a time. Wait for each to finish before sending the next.

## Prompt 1: read and plan

```
Read CLAUDE.md and HANDOFF.md in full, then open prototype/podium-v9.html and read its structure: the CSS tokens, the GAMES and DEF objects, the economy constants, and the render functions.

Do not write code yet. Reply with:
1. A summary of what you will build in Phase 0 and Phase 1.
2. The list of things you need from me before you can deploy (domain, VPS access, credentials).
3. Any place where HANDOFF.md and the prototype disagree.
```

## Prompt 2: Phase 0, live today

```
Do Phase 0 from HANDOFF.md section 5. Deploy prototype/podium-v9.html as a static site on my VPS using the podium-static block in deploy/nginx.conf.

Domain: <YOUR DOMAIN>
VPS: <USER@HOST>, I will approve each SSH command.

When it is live, give me the URL and tell me which of the four checks in section 5 you could verify yourself and which I need to do on my phone.
```

## Prompt 3: Phase 1 scaffold

```
Start Phase 1. Create the pnpm monorepo described in HANDOFF.md section 2, add docs/schema.prisma as the Prisma schema, and put every number from section 4 into packages/shared.

Then port the games: move each of the thirteen games from the prototype's DEF object into packages/games with a seeded random generator and a fixed 60 Hz step, as section 6 describes. Add a test per game proving the same seed and inputs give the same score.

Stop when the type check, tests and build pass, and tell me what you ran.
```

## Prompt 4: Phase 1 backend

```
Build the Fastify API from the table in HANDOFF.md section 6: auth, /me, runs, leaderboards, Cup, duels, challenges, missions, streak, season, boxes, shop, notifications, and the weekly close job.

Follow the hard rules in CLAUDE.md: server authority, idempotent money-like operations, no generated players. Write the route tests the conventions ask for.
```

## Prompt 5: Phase 1 frontend and deploy

```
Rebuild the pages in Next.js to match the prototype exactly, wired to the API. Export the cover art to static SVG files. Keep the in-game stage, HUD, countdown, pause menu, result screen, share card and touch pad.

Then deploy with deploy/ecosystem.config.js and the podium-app block in deploy/nginx.conf, and go through the Phase 1 acceptance list in HANDOFF.md section 6. Report each item as passed, failed or not checked.
```

## If Claude Code suggests adding real-token features

Answer: "No. Phase 3 is blocked until I confirm the legal opinion. Stay in tChips."
