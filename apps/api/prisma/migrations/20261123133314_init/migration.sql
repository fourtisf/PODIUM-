-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guest" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT,
    "googleId" TEXT,
    "wallet" TEXT,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "avatar" INTEGER NOT NULL DEFAULT 0,
    "frame" TEXT NOT NULL DEFAULT 'none',
    "balance" INTEGER NOT NULL DEFAULT 2000,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "boxes" INTEGER NOT NULL DEFAULT 1,
    "freePractice" INTEGER NOT NULL DEFAULT 3,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "streakDay" INTEGER NOT NULL DEFAULT 0,
    "refCode" TEXT NOT NULL,
    "referredById" TEXT,
    "refPaid" BOOLEAN NOT NULL DEFAULT false,
    "adult" BOOLEAN NOT NULL DEFAULT false,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "duelsWon" INTEGER NOT NULL DEFAULT 0,
    "duelsLost" INTEGER NOT NULL DEFAULT 0,
    "rankedDone" INTEGER NOT NULL DEFAULT 0,
    "validatedRanked" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "deviceHash" TEXT,
    "lastIp" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "idemKey" TEXT NOT NULL,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" INTEGER NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Period" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "pool" INTEGER NOT NULL DEFAULT 0,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "payout" INTEGER NOT NULL DEFAULT 0,
    "place" INTEGER,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "gameVersion" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "entry" INTEGER NOT NULL,
    "periodId" TEXT,
    "score" INTEGER,
    "clientScore" INTEGER,
    "frames" INTEGER,
    "durationMs" INTEGER,
    "inputLog" BYTEA,
    "streamedTo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "rewardsHeld" BOOLEAN NOT NULL DEFAULT false,
    "duelId" TEXT,
    "challengeCode" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duel" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "game" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "creatorId" TEXT NOT NULL,
    "joinerId" TEXT,
    "creatorScore" INTEGER,
    "joinerScore" INTEGER,
    "creatorAt" TIMESTAMP(3),
    "matchedAt" TIMESTAMP(3),
    "winnerId" TEXT,
    "settledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MissionProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "mission" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,

    CONSTRAINT "MissionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,

    CONSTRAINT "SeasonClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,
    "invitedId" TEXT NOT NULL,
    "week" TEXT NOT NULL,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "game" TEXT NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_nameLower_key" ON "User"("nameLower");

-- CreateIndex
CREATE UNIQUE INDEX "User_refCode_key" ON "User"("refCode");

-- CreateIndex
CREATE INDEX "User_deviceHash_idx" ON "User"("deviceHash");

-- CreateIndex
CREATE INDEX "User_lastIp_idx" ON "User"("lastIp");

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_kind_ref_key" ON "Item"("userId", "kind", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_idemKey_key" ON "Ledger"("idemKey");

-- CreateIndex
CREATE INDEX "Ledger_userId_createdAt_idx" ON "Ledger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Idempotency_createdAt_idx" ON "Idempotency"("createdAt");

-- CreateIndex
CREATE INDEX "Period_closed_endAt_idx" ON "Period"("closed", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "Period_kind_game_startAt_key" ON "Period"("kind", "game", "startAt");

-- CreateIndex
CREATE INDEX "Score_periodId_score_idx" ON "Score"("periodId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Score_periodId_userId_key" ON "Score"("periodId", "userId");

-- CreateIndex
CREATE INDEX "Run_userId_createdAt_idx" ON "Run"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_duelId_idx" ON "Run"("duelId");

-- CreateIndex
CREATE INDEX "Duel_game_stake_status_idx" ON "Duel"("game", "stake", "status");

-- CreateIndex
CREATE INDEX "Duel_creatorId_createdAt_idx" ON "Duel"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Duel_joinerId_createdAt_idx" ON "Duel"("joinerId", "createdAt");

-- CreateIndex
CREATE INDEX "Duel_status_expiresAt_idx" ON "Duel"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_runId_key" ON "Challenge"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionProgress_userId_day_mission_key" ON "MissionProgress"("userId", "day", "mission");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonClaim_userId_season_tier_key" ON "SeasonClaim"("userId", "season", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_invitedId_key" ON "ReferralReward"("invitedId");

-- CreateIndex
CREATE INDEX "ReferralReward_inviterId_week_idx" ON "ReferralReward"("inviterId", "week");

-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProgress" ADD CONSTRAINT "MissionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonClaim" ADD CONSTRAINT "SeasonClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
