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
  | 'internal';

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
  address: string;
}
export interface WalletNonceResponse {
  /** The exact text to sign with personal_sign. Signing proves identity only; no transaction is made. */
  message: string;
  nonce: string;
}
export interface WalletVerifyBody {
  address: string;
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
