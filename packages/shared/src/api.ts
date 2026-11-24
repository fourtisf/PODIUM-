// Request and response shapes of every /api route. Types only: nothing here may import from Node.
// The API (apps/api) returns exactly these; the web app imports them.
import type { GameKey } from './games';
import type { MissionId } from './missions';
import type { SeasonReward } from './season';

// ---------------------------------------------------------------- errors
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'csrf'
  | 'guest_not_allowed'
  | 'not_adult'
  | 'not_enough_chips'
  | 'invalid'
  | 'rate_limited'
  | 'conflict'
  | 'not_found'
  | 'rewards_locked'
  | 'run_rejected'
  | 'unavailable'
  | 'internal'
  /** Phase 3 (devnet test token): value features are closed in this country. HTTP 451. */
  | 'country_blocked'
  /** Phase 3 (devnet test token): the action needs a linked Solana wallet. */
  | 'wallet_required';

/** Body of every non-2xx answer. */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Extra machine-readable data, e.g. `{ runsLeft: 2 }` for rewards_locked. */
    details?: Record<string, string | number | boolean>;
  };
}

export interface OkResponse {
  ok: true;
}

export type RunMode = 'ranked' | 'practice' | 'cup' | 'duel' | 'challenge';
export type RunStatus = 'open' | 'finished' | 'rejected' | 'flagged';

/** A player as shown on boards, duels and challenges. */
export interface PlayerRef {
  name: string;
  avatar: number;
  frame: string;
}

// ---------------------------------------------------------------- auth
export interface CsrfResponse {
  /** Send it in the `x-csrf-token` header of every non-GET request. Changes when the session changes. */
  csrf: string;
}

/** Answer of every sign-in step that changes the session (guest, email, wallet, adult). */
export interface AuthResponse {
  ok: true;
  userId: string;
  name: string;
  guest: boolean;
  adult: boolean;
  /** True when this call created the account (or upgraded a guest to a signed-in account). */
  created: boolean;
  /** The CSRF token of the (possibly new) session. */
  csrf: string;
}

export interface EmailRequestBody {
  email: string;
}
export interface EmailVerifyBody {
  email: string;
  code: string;
  /** Must be true to create an account (18 or over). */
  adult: boolean;
  name?: string;
  /** Inviter's referral code. */
  ref?: string;
}
export interface WalletNonceBody {
  /** Solana address (base58 public key). */
  address: string;
}
export interface WalletNonceResponse {
  /** The exact text to sign with the Solana wallet's signMessage. Signing proves identity only; no transaction is made. */
  message: string;
  nonce: string;
}
export interface WalletVerifyBody {
  address: string;
  /** base58 ed25519 signature of the nonce message. */
  signature: string;
  adult: boolean;
  name?: string;
  ref?: string;
}
export interface AdultBody {
  adult: true;
}

// ---------------------------------------------------------------- profile
export interface MeUser {
  id: string;
  name: string;
  guest: boolean;
  adult: boolean;
  avatar: number;
  frame: string;
  balance: number;
  xp: number;
  level: number;
  boxes: number;
  freePractice: number;
  refCode: string;
  stats: { plays: number; spent: number; won: number; duelsWon: number; duelsLost: number };
  /** Owned cosmetics. Free avatars and the "none" frame are always included. */
  items: { avatars: number[]; frames: string[] };
  flagged: boolean;
}

export interface StreakState {
  claimedToday: boolean;
  /** The streak day the next claim will be (or today's, once claimed). */
  nextDay: number;
  /** tChips of that day before emission scaling. */
  amount: number;
  box: boolean;
}

export interface MissionState {
  id: MissionId;
  title: string;
  target: number;
  progress: number;
  claimed: boolean;
  chips: number;
  xp: number;
}

export interface SeasonTierState {
  tier: number;
  xp: number;
  reward: SeasonReward;
  claimed: boolean;
  /** Enough XP and not yet claimed. */
  ready: boolean;
}

export interface MeResponse {
  user: MeUser;
  streak: StreakState;
  missions: MissionState[];
  missionsBonusClaimed: boolean;
  season: SeasonTierState[];
  unread: number;
  csrf: string;
  canRefill: boolean;
  /** Mission, streak and referral rewards are open to this account. */
  rewardsUnlocked: boolean;
  /** Validated ranked runs so far, and how many are needed. */
  validatedRuns: number;
  validatedRunsNeeded: number;
  serverTime: string;
  /** Phase 3 (devnet test token). null while CHAIN_MODE is off. */
  chain: MeChain | null;
}

export interface PatchMeBody {
  name?: string;
  avatar?: number;
  frame?: string;
}

export interface RefillResponse {
  added: number;
  balance: number;
}

// ---------------------------------------------------------------- games and boards
export interface TopEntry extends PlayerRef {
  score: number;
}

export interface GameCard {
  key: GameKey;
  pool: number;
  endsAt: string;
  top3: TopEntry[];
  /** The caller's best this week, or null (also null when signed out). */
  myBest: number | null;
  /** Ranked runs started on this game this week (all players). */
  plays: number;
}

export interface GamesResponse {
  games: GameCard[];
  /** Featured game with the largest pool; ties go to FEATURED_ORDER. */
  hero: GameKey;
  serverTime: string;
}

export interface BoardRow extends PlayerRef {
  place: number;
  userId: string;
  score: number;
  /** What this place would win if the period closed now. */
  prize: number;
}

export interface BoardResponse {
  game: GameKey;
  period: { startAt: string; endAt: string };
  pool: number;
  /** Platform fee on the pool as it stands. */
  fee: number;
  /** Projected prizes for the paid places, first place first. */
  payouts: number[];
  /** Top 50. */
  rows: BoardRow[];
  me: { place: number; score: number } | null;
  beta: true;
}
export type LeaderboardResponse = BoardResponse;
export interface CupResponse extends BoardResponse {
  entry: number;
}

export interface ActivityItem {
  name: string;
  text: string;
  game: string;
  at: string;
}
export interface ActivityResponse {
  items: ActivityItem[];
}

// ---------------------------------------------------------------- runs
export interface StartRunRequest {
  game: GameKey;
  mode: RunMode;
  duelId?: string;
  challengeCode?: string;
}

export interface StartRunResponse {
  runId: string;
  seed: number;
  gameVersion: number;
  /** tChips charged for this run (0 for free practice, duels and challenges). */
  entry: number;
  balance: number;
  freePractice: number;
  /** Authenticates the live input stream: WS /api/runs/:id/stream?token=... */
  streamToken: string;
}

/** One message on the live input stream. */
export interface StreamChunk {
  /** First frame this chunk covers (the previous chunk's `to`, or 0). */
  from: number;
  /** Frame the run has reached. */
  to: number;
  /** Flat [frame, code, value] triples recorded since the previous chunk. */
  ev: number[];
  paused?: boolean;
}
/** What the server sends back on the stream. */
export type StreamReply = { ok: true; to: number } | { ended: true; reason: string };

export interface FinishRunRequest {
  /** The browser's score. Stored for comparison, never used. */
  score: number;
  /** Fixed 60 Hz steps simulated. */
  frames: number;
  /** Flat [frame, code, value] triples. */
  inputLog: number[];
}

export type RunBadge = 'new_best' | 'prize_zone' | 'box' | 'duel_won' | 'duel_lost' | 'duel_waiting' | 'challenge_won' | 'challenge_lost' | 'not_recorded' | 'held';

export interface FinishRunResponse {
  runId: string;
  status: 'finished' | 'flagged';
  game: GameKey;
  mode: RunMode;
  /** The server's score from replaying the input log. */
  score: number;
  /** Place on the board (ranked and Cup), else 0. */
  place: number;
  newBest: boolean;
  xpGained: number;
  boxDropped: boolean;
  badges: RunBadge[];
  /** tChips the current place would win if the period closed now. */
  prizeIfHeld: number;
  /** True when the run was flagged: nothing was recorded and rewards wait for review. */
  rewardsHeld: boolean;
  duel?: {
    /** null while the duel waits for an opponent. */
    won: boolean | null;
    opponent: string | null;
    opponentScore: number | null;
    /** tChips paid to the caller by this result. */
    payout: number;
    stake: number;
  };
  challenge?: { won: boolean; opponent: string; target: number };
  top5: { place: number; name: string; score: number; me: boolean }[];
  user: { balance: number; xp: number; level: number; boxes: number };
  /** Missions this run completed (now claimable). */
  missionsCompleted: MissionId[];
}

// ---------------------------------------------------------------- duels
export interface DuelView {
  id: string;
  game: GameKey;
  stake: number;
  status: 'waiting' | 'matched' | 'settled' | 'refunded';
  role: 'creator' | 'joiner';
  /** The caller's score, once their run is accepted. */
  myScore: number | null;
  /** True while the caller still has their one run to play. */
  canPlay: boolean;
  /** For the joiner: the score to beat. */
  target: number | null;
  opponent: string | null;
  expiresAt: string;
}

export interface CreateDuelRequest {
  game: GameKey;
  stake: number;
}
export interface CreateDuelResponse {
  duel: DuelView;
  role: 'creator' | 'joiner';
  target: number | null;
  opponent: string | null;
  balance: number;
}

export interface DuelHistoryItem {
  id: string;
  game: GameKey;
  opponent: string;
  myScore: number | null;
  theirScore: number | null;
  win: boolean;
  /** Net tChips: payout minus stake for a win, minus stake for a loss. */
  amount: number;
}
export interface DuelsResponse {
  open: DuelView | null;
  /** Duels of mine that have a score and wait for an opponent. */
  waiting: DuelView[];
  history: DuelHistoryItem[];
  won: number;
  lost: number;
}

// ---------------------------------------------------------------- challenges
export interface CreateChallengeRequest {
  runId: string;
}
export interface CreateChallengeResponse {
  code: string;
}
export interface ChallengeResponse extends PlayerRef {
  code: string;
  game: GameKey;
  score: number;
}

/** A ghost: a real player's accepted run from this week's board, playable as a free challenge (XP only). */
export interface GhostEntry extends PlayerRef {
  /** Challenge code to play against it (`mode: 'challenge'`, `challengeCode`). */
  code: string;
  score: number;
  /** The run's place on this week's board. */
  place: number;
}
/** GET /ghosts/:game: up to five of the best real runs of the current week, the caller's own excluded. */
export interface GhostsResponse {
  game: GameKey;
  ghosts: GhostEntry[];
}

// ---------------------------------------------------------------- rewards
/** tChips paid from the daily emissions budget. */
export interface EmissionPaid {
  /** Actually paid. */
  chips: number;
  /** The full amount before scaling. */
  nominal: number;
  scaled: boolean;
}

export interface MissionClaimResponse extends EmissionPaid {
  id: MissionId;
  xp: number;
  /** A mystery box for clearing all three. */
  bonusBox: boolean;
  balance: number;
  boxes: number;
}
export interface StreakClaimResponse extends EmissionPaid {
  day: number;
  box: boolean;
  balance: number;
  boxes: number;
}
export interface SeasonClaimResponse extends EmissionPaid {
  tier: number;
  reward: SeasonReward;
  /** The cosmetic was already owned, so tChips were paid instead. */
  fallback: boolean;
  balance: number;
  boxes: number;
}

export type BoxPrize =
  | { kind: 'avatar'; avatar: number; name: string }
  | { kind: 'frame'; frame: string; name: string }
  | { kind: 'xp'; amount: number }
  | ({ kind: 'chips' } & EmissionPaid);

export interface BoxOpenResponse {
  prize: BoxPrize;
  boxes: number;
  balance: number;
  xp: number;
}

export interface ShopBuyRequest {
  kind: 'box' | 'avatar' | 'frame';
  /** Avatar number or frame key; not used for a box. */
  id?: number | string;
}
export interface ShopBuyResponse {
  kind: 'box' | 'avatar' | 'frame';
  id: number | string | null;
  price: number;
  burned: number;
  balance: number;
  boxes: number;
}
export interface ShopResponse {
  /** tChips burned by all purchases so far. */
  burned: number;
  box: { price: number };
  avatars: { id: number; name: string; price: number; owned: boolean }[];
  frames: { id: string; name: string; price: number; owned: boolean }[];
}

// ---------------------------------------------------------------- notifications
export interface NotificationItem {
  id: string;
  kind: string;
  /** May contain <b> tags only; names are escaped on the server. */
  body: string;
  read: boolean;
  at: string;
}
export interface NotificationsResponse {
  items: NotificationItem[];
  unread: number;
}

export interface HealthResponse {
  ok: boolean;
}

// ---------------------------------------------------------------- admin (operators only)
export interface AdminOverviewResponse {
  users: number;
  signedInUsers: number;
  runsToday: number;
  flaggedPending: number;
  rejectedToday: number;
  openDuels: number;
  /** Fees recorded today (UTC), in tChips. */
  feesToday: number;
  pools: { game: GameKey; pool: number; endsAt: string }[];
  cup: { game: GameKey; pool: number; endsAt: string };
  /** Only while chain mode is on. */
  chain: { pendingOps: number; failedOps: number; holds: number } | null;
}
export interface AdminPressStats {
  presses: number;
  peakPerSecond: number;
  intervalCv: number;
}
export interface AdminRunRow {
  id: string;
  user: { id: string; name: string };
  game: GameKey;
  mode: RunMode;
  status: RunStatus;
  score: number | null;
  clientScore: number | null;
  reason: string | null;
  frames: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** null when the run has no stored input log. */
  press: AdminPressStats | null;
}
export interface AdminRunsResponse {
  runs: AdminRunRow[];
  /** Pass as `cursor` for the next page; null on the last page. */
  next: string | null;
}
export interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  wallet: string | null;
  guest: boolean;
  flagged: boolean;
  chainHold: boolean;
  balance: number;
  createdAt: string;
}
export interface AdminUsersResponse {
  users: AdminUserRow[];
}
export interface AdminUserDetail extends AdminUserRow {
  adult: boolean;
  xp: number;
  level: number;
  avatar: number;
  frame: string;
  googleLinked: boolean;
  stats: MeUser['stats'];
  validatedRanked: number;
  lastIp: string | null;
  ledger: { id: string; createdAt: string; amount: number; reason: string; ref: string | null }[];
  runs: AdminRunRow[];
  actions: AdminActionItem[];
}
export interface AdminActionItem {
  id: string;
  createdAt: string;
  admin: string;
  action: string;
  targetUserId: string | null;
  targetRunId: string | null;
  note: string | null;
}
export interface AdminNoteBody {
  note?: string;
}
export interface AdminFlagBody {
  flagged: boolean;
  note?: string;
}
export interface AdminRunActionResponse {
  ok: true;
  run: AdminRunRow;
}
export interface AdminUserActionResponse {
  ok: true;
  user: AdminUserRow;
}

// ---------------------------------------------------------------- Phase 3: devnet test token
// Only present while the API runs with CHAIN_MODE=localnet or devnet. The token is a valueless
// test token on a test network; mainnet cannot be configured.
export type ChainMode = 'off' | 'localnet' | 'devnet';

export interface MeChain {
  mode: Exclude<ChainMode, 'off'>;
  /** The linked Solana address, or null. */
  wallet: string | null;
  /** True for a signed-in account without a wallet: ranked, Cup, duels, shop and rewards need one. */
  needsWallet: boolean;
}

/** GET /chain/config (public). With CHAIN_MODE off only `mode: 'off'` is meaningful. */
export interface ChainConfigResponse {
  mode: ChainMode;
  cluster: 'localnet' | 'devnet' | null;
  programId: string | null;
  mint: string | null;
  /** Base units of the token per whole tChip. */
  unit: number;
  decimals: number;
  tokenLabel: 'tChips';
  /** The test-token faucet is switched on. */
  faucet: boolean;
  /** tChips one faucet request gives. */
  faucetAmount: number;
  /** Delay before reward tChips can be withdrawn. */
  vestSeconds: number;
  feeBps: number;
  burnBps: number;
  /** Value features are closed for the country this request came from. */
  blocked: boolean;
}

export type WithdrawalStatus = 'prepared' | 'submitted' | 'confirmed' | 'expired' | 'failed';

export interface OpenWithdrawal {
  id: string;
  amount: number;
  status: WithdrawalStatus;
}

/** GET /chain/status (signed in). All amounts are whole tChips. */
export interface ChainStatusResponse {
  wallet: string | null;
  /** The wallet has its account in the program. */
  registered: boolean;
  onchain: {
    available: number;
    /** Reward tChips still vesting: playable, not withdrawable yet. */
    locked: number;
    /** When the vesting part unlocks (ISO), or null when nothing is vesting. */
    unlockAt: string | null;
  };
  /** What a withdrawal could take right now. */
  withdrawable: number;
  dbBalance: number;
  /** Operations of this player that are still being written to the chain. */
  pendingOps: number;
  /** Withdrawals are on hold while this account is reviewed. */
  hold: boolean;
  openWithdrawal: OpenWithdrawal | null;
  /** Deposits found on-chain and credited by this call. */
  credited: number;
}

export interface WalletLinkBody {
  address: string;
  /** base58 signature of the message from POST /auth/wallet/nonce. */
  signature: string;
}

export interface DepositConfirmRequest {
  /** Signature (base58) of the deposit transaction the wallet sent. */
  signature: string;
}
export interface DepositConfirmResponse {
  /** tChips credited by this call (0 when the signature was credited before). */
  credited: number;
  /** The deposit's amount in tChips. */
  amount: number;
  balance: number;
}

export interface WithdrawPrepareRequest {
  /** Whole tChips. */
  amount: number;
}
export interface WithdrawPrepareResponse {
  withdrawId: string;
  amount: number;
  /** Unsigned transaction (base64) for the wallet's signTransaction. The server co-signs and sends it. */
  transaction: string;
  lastValidBlockHeight: number;
  balance: number;
}
export interface WithdrawSubmitRequest {
  withdrawId: string;
  /** The transaction signed by the wallet, base64, serialized without requiring all signatures. */
  signedTx: string;
}
export interface WithdrawSubmitResponse {
  withdrawId: string;
  status: WithdrawalStatus;
  signature: string | null;
  balance: number;
}

export interface FaucetResponse {
  /** Test tokens (whole tChips) minted to the wallet's token account. */
  amount: number;
  signature: string;
}
