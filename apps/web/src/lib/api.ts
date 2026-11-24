// The one typed client for the Fastify API. Browser only (server rendering uses server-api.ts).
// Rules: every non-GET carries x-csrf-token and x-device; money-like mutations carry an
// Idempotency-Key that is reused when the same user action is retried after a network error.
import type {
  ActivityResponse,
  AdminOverviewResponse,
  AdminRunActionResponse,
  AdminRunsResponse,
  AdminUserActionResponse,
  AdminUserDetail,
  AdminUsersResponse,
  ApiErrorCode,
  AuthResponse,
  BoardResponse,
  BoxOpenResponse,
  ChainConfigResponse,
  ChainStatusResponse,
  ChallengeResponse,
  CreateChallengeResponse,
  CreateDuelResponse,
  CsrfResponse,
  CupResponse,
  DepositConfirmResponse,
  DuelsResponse,
  FaucetResponse,
  FinishRunRequest,
  FinishRunResponse,
  GameKey,
  GamesResponse,
  GhostsResponse,
  MeResponse,
  MissionClaimResponse,
  NotificationsResponse,
  OkResponse,
  PatchMeBody,
  RefillResponse,
  SeasonClaimResponse,
  ShopBuyRequest,
  ShopBuyResponse,
  ShopResponse,
  StartRunRequest,
  StartRunResponse,
  StreakClaimResponse,
  WalletNonceResponse,
  WithdrawPrepareResponse,
  WithdrawSubmitResponse,
} from '@podium/shared';

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly status: number,
    readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/** Text for the toast, whatever was thrown. */
export const errorText = (e: unknown): string =>
  e instanceof ApiFailure ? e.message : 'Something went wrong. Please try again.';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientDeps {
  fetch: FetchLike;
  /** Small persistent store for the device id (localStorage in the browser). */
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  uuid: () => string;
  base?: string;
}

const DEVICE_KEY = 'podium.device';

export function createClient(deps: ClientDeps) {
  const base = deps.base ?? '/api';
  let csrf: string | null = null;
  let device: string | null = null;
  /** Idempotency keys of actions that have not had an answer from the server yet. */
  const pending = new Map<string, string>();

  const deviceId = (): string => {
    if (device) return device;
    try {
      device = deps.storage?.getItem(DEVICE_KEY) ?? null;
      if (!device) {
        device = deps.uuid();
        deps.storage?.setItem(DEVICE_KEY, device);
      }
    } catch {
      device = device || deps.uuid();
    }
    return device;
  };

  async function parse<T>(res: Response): Promise<T> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (res.ok) return body as T;
    const err = (body as { error?: { code?: ApiErrorCode; message?: string; details?: Record<string, string | number | boolean> } } | null)?.error;
    throw new ApiFailure(err?.code ?? 'internal', err?.message ?? 'Something went wrong. Please try again.', res.status, err?.details);
  }

  async function raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    try {
      return await deps.fetch(base + path, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiFailure('network', 'Network error. Check your connection and try again.', 0);
    }
  }

  const get = async <T>(path: string): Promise<T> => parse<T>(await raw('GET', path));

  async function fetchCsrf(): Promise<string> {
    const r = await get<CsrfResponse>('/auth/csrf');
    csrf = r.csrf;
    return csrf;
  }

  /** A non-GET request. `action` names the user action for idempotency; omit it for calls that move nothing. */
  async function send<T>(method: string, path: string, body?: unknown, action?: string): Promise<T> {
    const headers: Record<string, string> = { 'x-device': deviceId() };
    if (action) {
      let key = pending.get(action);
      if (!key) {
        key = deps.uuid();
        pending.set(action, key);
      }
      headers['Idempotency-Key'] = key;
    }
    try {
      headers['x-csrf-token'] = csrf ?? (await fetchCsrf());
      let res = await raw(method, path, body, headers);
      if (res.status === 403) {
        // The token may be stale (the session changed in another tab): refetch once and retry.
        const peek = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
        if (peek?.error?.code === 'csrf') {
          headers['x-csrf-token'] = await fetchCsrf();
          res = await raw(method, path, body, headers);
        }
      }
      const out = await parse<T>(res);
      if (action) pending.delete(action);
      const c = (out as { csrf?: unknown } | null)?.csrf;
      if (typeof c === 'string') csrf = c;
      return out;
    } catch (e) {
      // The server answered: the action is settled, a later attempt is a new action.
      // A network error keeps the key so the retry cannot charge or pay twice.
      if (action && !(e instanceof ApiFailure && e.code === 'network')) pending.delete(action);
      throw e;
    }
  }

  const post = <T>(path: string, body?: unknown, action?: string) => send<T>('POST', path, body ?? {}, action);

  return {
    /** Lets the app hand over the token it already got from server rendering or /me. */
    setCsrf(token: string | null) {
      csrf = token;
    },
    // ---- auth
    guest: () => post<AuthResponse>('/auth/guest'),
    emailRequest: (email: string) => post<OkResponse>('/auth/email/request', { email }),
    emailVerify: (b: { email: string; code: string; adult: boolean; name?: string; ref?: string }) => post<AuthResponse>('/auth/email/verify', b),
    walletNonce: (address: string) => post<WalletNonceResponse>('/auth/wallet/nonce', { address }),
    walletVerify: (b: { address: string; signature: string; adult: boolean; name?: string; ref?: string }) => post<AuthResponse>('/auth/wallet/verify', b),
    adult: () => post<AuthResponse>('/auth/adult', { adult: true }),
    logout: async () => {
      const r = await post<OkResponse>('/auth/logout');
      csrf = null;
      return r;
    },
    // ---- profile
    me: async () => {
      const r = await get<MeResponse>('/me');
      csrf = r.csrf;
      return r;
    },
    patchMe: (b: PatchMeBody) => send<MeResponse | OkResponse>('PATCH', '/me', b),
    refill: () => post<RefillResponse>('/refill', {}, 'refill'),
    // ---- games and boards
    games: () => get<GamesResponse>('/games'),
    leaderboard: (game: GameKey) => get<BoardResponse>(`/leaderboard/${game}`),
    cup: () => get<CupResponse>('/cup'),
    activity: () => get<ActivityResponse>('/activity'),
    // ---- runs
    startRun: (b: StartRunRequest) => post<StartRunResponse>('/runs', b, `run:${b.game}:${b.mode}:${b.duelId ?? b.challengeCode ?? ''}`),
    finishRun: (runId: string, b: FinishRunRequest) => post<FinishRunResponse>(`/runs/${runId}/finish`, b, `finish:${runId}`),
    // ---- duels
    createDuel: (game: GameKey, stake: number) => post<CreateDuelResponse>('/duels', { game, stake }, `duel:${game}:${stake}`),
    duels: () => get<DuelsResponse>('/duels'),
    // ---- challenges
    createChallenge: (runId: string) => post<CreateChallengeResponse>('/challenges', { runId }, `challenge:${runId}`),
    challenge: (code: string) => get<ChallengeResponse>(`/challenges/${encodeURIComponent(code)}`),
    ghosts: (game: GameKey) => get<GhostsResponse>(`/ghosts/${game}`),
    // ---- rewards
    claimMission: (id: string) => post<MissionClaimResponse>(`/missions/${id}/claim`, {}, `mission:${id}`),
    claimStreak: () => post<StreakClaimResponse>('/streak/claim', {}, 'streak'),
    claimSeason: (tier: number) => post<SeasonClaimResponse>(`/season/${tier}/claim`, {}, `season:${tier}`),
    openBox: () => post<BoxOpenResponse>('/boxes/open', {}, 'box'),
    shopBuy: (b: ShopBuyRequest) => post<ShopBuyResponse>('/shop/buy', b, `buy:${b.kind}:${b.id ?? ''}`),
    shop: () => get<ShopResponse>('/shop'),
    // ---- notifications
    notifications: () => get<NotificationsResponse>('/notifications'),
    notificationsRead: () => post<OkResponse>('/notifications/read'),
    // ---- devnet test token (only called while chain mode is on)
    chainConfig: () => get<ChainConfigResponse>('/chain/config'),
    chainStatus: () => get<ChainStatusResponse>('/chain/status'),
    walletLink: (b: { address: string; signature: string }) => post<AuthResponse>('/auth/wallet/link', b),
    walletUnlink: () => post<OkResponse>('/auth/wallet/unlink'),
    /** The transaction signature is the idempotency key on the server. */
    depositConfirm: (signature: string) => post<DepositConfirmResponse>('/chain/deposit/confirm', { signature }),
    withdrawPrepare: (amount: number) => post<WithdrawPrepareResponse>('/chain/withdraw/prepare', { amount }, `withdraw:${amount}`),
    withdrawSubmit: (withdrawId: string, signedTx: string) => post<WithdrawSubmitResponse>('/chain/withdraw/submit', { withdrawId, signedTx }),
    faucet: () => post<FaucetResponse>('/chain/faucet'),
    // ---- operators only (/admin)
    adminOverview: () => get<AdminOverviewResponse>('/admin/overview'),
    adminRuns: (status: 'flagged' | 'rejected', cursor?: string) =>
      get<AdminRunsResponse>(`/admin/runs?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    adminApprove: (runId: string, note: string) => post<AdminRunActionResponse>(`/admin/runs/${encodeURIComponent(runId)}/approve`, { note }, `admin:approve:${runId}`),
    adminReject: (runId: string, note: string) => post<AdminRunActionResponse>(`/admin/runs/${encodeURIComponent(runId)}/reject`, { note }, `admin:reject:${runId}`),
    adminUsers: (q: string) => get<AdminUsersResponse>(`/admin/users?q=${encodeURIComponent(q)}`),
    adminUser: (id: string) => get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`),
    adminFlag: (id: string, flagged: boolean, note: string) =>
      post<AdminUserActionResponse>(`/admin/users/${encodeURIComponent(id)}/flag`, { flagged, note }, `admin:flag:${id}:${flagged}`),
    adminClearHold: (id: string, note: string) => post<AdminUserActionResponse>(`/admin/users/${encodeURIComponent(id)}/clear-hold`, { note }, `admin:hold:${id}`),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

const randomId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
};

const browserStorage = (): ClientDeps['storage'] => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The app's client. Safe to import on the server (it is only called in the browser). */
export const api: ApiClient = createClient({
  fetch: (url, init) => fetch(url, init),
  get storage() {
    return browserStorage();
  },
  uuid: randomId,
});

/** Where the live input stream connects. Rewrites do not proxy WebSockets. */
export function wsBase(loc: { protocol: string; host: string; hostname: string } = location): string {
  const fixed = process.env.NEXT_PUBLIC_WS_URL;
  if (fixed) return fixed.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'development') return `ws://${loc.hostname}:4000`;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
}
