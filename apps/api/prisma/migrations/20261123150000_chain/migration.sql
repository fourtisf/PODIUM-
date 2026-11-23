-- Phase 3 (devnet test token): on-chain mirror outbox, withdrawals, and the per-player hold.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "chainHold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChainOp" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "seq" BIGINT,
    "signature" TEXT,
    "error" TEXT,
    "ref" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChainOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "blockhash" TEXT NOT NULL,
    "lastValidBlockHeight" INTEGER NOT NULL,
    "signature" TEXT,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChainOp_ref_key" ON "ChainOp"("ref");

-- CreateIndex
CREATE INDEX "ChainOp_status_id_idx" ON "ChainOp"("status", "id");

-- CreateIndex
CREATE INDEX "ChainOp_userId_status_idx" ON "ChainOp"("userId", "status");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_status_idx" ON "Withdrawal"("userId", "status");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- AddForeignKey
ALTER TABLE "ChainOp" ADD CONSTRAINT "ChainOp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

