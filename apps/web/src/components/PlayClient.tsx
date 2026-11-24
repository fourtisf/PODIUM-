'use client';
// The immersive in-game stage (the prototype's #ov overlay) as its own page.
// Flow: POST /runs (the server charges the entry) -> 3-2-1 -> play at a fixed 60 Hz step while
// streaming inputs -> death (0.7 s shake and flash) -> POST finish -> result from the server.
// The browser only displays: the score, place, XP and prizes on the result come from the response.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { H, LiveRun, Particles, W, gameDef, gameDefVersion, reducedMotion, speedLines } from '@podium/games';
import type { Fx, GameView } from '@podium/games';
import { ANTI_ABUSE, BRAND, CUP_WINNERS, ECONOMY, GAMES, WEEKLY_WINNERS, fmt, levelCeil, levelFloor, missionDef } from '@podium/shared';
import type { BoardResponse, FinishRunResponse, GameKey, RunMode, StartRunResponse, StreamReply } from '@podium/shared';
import { ApiFailure, api, wsBase } from '@/lib/api';
import { beep, drum, isMuted, setMuted, startMusic, stopMusic } from '@/lib/audio';
import {
  Accumulator, StreamCursor, keyDownEvents, keyUpEvents, logUpTo, newHeld, padDownEvents, padUpEvents, pointerDownEvents, pointerMoveEvents,
  pointerUpEvents, releaseAllEvents, type EvPair,
} from '@/lib/recorder';
import { renderShareCard } from '@/lib/sharecard';
import type { Scene3D } from '@/game3d/types';
import { useContent, useErrors, useT } from '@/i18n/client';
import type { Translator } from '@/i18n/core';
import { commonEn } from '@/i18n/dict/common.en';
import { playEn } from '@/i18n/dict/play.en';
import { PlaySide, emptySnap, type SideSnap } from './PlaySide';
import { runCost, useSession } from './Session';
import { TutorialCard, markTutorialSeen, tutorialSeen } from './Tutorial';
import { Cover } from './ui';

type Phase = 'loading' | 'count' | 'play' | 'pause' | 'dying' | 'saving' | 'over';

interface TargetRow {
  n: string;
  s: number;
  me?: boolean;
}
interface Targets {
  rows: TargetRow[];
  best: number;
  duel: { opp: string | null; target: number | null; friend: boolean } | null;
  /** Ranked and Cup: the pool and the period's end, for the desktop side panel. */
  pool?: number | null;
  endAt?: string | null;
}

interface ResultView {
  title: string;
  score: number;
  badges: { c: string; t: string }[];
  info: string;
  rows: { place: number; name: string; score: number; me: boolean }[];
  level: number;
  xpPct: number;
  xpToGo: number;
  again: string;
  /** Set when the run was accepted, so it can be shared as a challenge. */
  runId: string | null;
  shareLine: string;
  cheer: boolean;
}

interface Engine {
  pause(on: boolean): void;
  toggleMute(): void;
  pad(k: 'l' | 'r' | 'a', down: boolean): void;
}

const kick = (el: Element | null, cls: string) => {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
};
/** Like kick(), but the class is removed again when its animation ends (so it cannot mask other animations). */
const kickOnce = (el: Element | null, cls: string) => {
  if (!el) return;
  kick(el, cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
};
/** Score milestones: 10, 25, 50, 100, 250, 500, 1000, ... */
const nextMilestone = (m: number): number => {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  const k = Math.round(m / p);
  return k < 2.5 ? (k === 1 ? 2.5 * p : 5 * p) : k < 5 ? 5 * p : 10 * p;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const STREAMED: RunMode[] = ['ranked', 'cup', 'duel'];
type PlayT = Translator<keyof typeof playEn>;
const modeTag = (t: PlayT, mode: RunMode): string => t(`mode.${mode}`);

const ARROW = (d: number) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d < 0 ? 'M15 4L7 12l8 8z' : 'M9 4l8 8-8 8z'} />
  </svg>
);

export function PlayClient({ game, mode, duelId, code, forcePad }: { game: GameKey; mode: RunMode; duelId?: string; code?: string; forcePad?: boolean }) {
  const router = useRouter();
  const session = useSession();
  const sref = useRef(session);
  sref.current = session;
  const g = GAMES[game];
  const t = useT('play', playEn);
  const tc = useT('common', commonEn);
  const content = useContent();
  const errs = useErrors();
  const gc = content.game(game);
  // The run's effect reads the current language through this ref (the language cannot change mid-run).
  const lref = useRef({ t, tc, content, errs, gc });
  lref.current = { t, tc, content, errs, gc };

  const [phase, setPhaseState] = useState<Phase>('loading');
  const [result, setResult] = useState<ResultView | null>(null);
  const [muted, setMutedState] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [xpOn, setXpOn] = useState(false);
  const [share, setShare] = useState<{ img: string | null; link: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  // First run of this game in this browser: the how-to-play card, dismissed before the run starts.
  const [tut, setTut] = useState(false);
  const tutDone = useRef<(() => void) | null>(null);
  const closeTut = useCallback(() => {
    markTutorialSeen(game);
    setTut(false);
    const f = tutDone.current;
    tutDone.current = null;
    f?.();
  }, [game]);
  const shareOpen = useRef(false);
  shareOpen.current = !!share;

  const ovRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cvxRef = useRef<HTMLCanvasElement>(null);
  const vigRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const popsRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<HTMLDivElement>(null);
  const nbestRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<SideSnap>(emptySnap());
  // Browser full screen on the play overlay (button and the F key). Escape leaves it natively.
  const [fsOk, setFsOk] = useState(false);
  const [fsOn, setFsOn] = useState(false);
  const fsAt = useRef(0);
  const toggleFs = useCallback(() => {
    const el = ovRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    } catch {
      /* not allowed here */
    }
  }, []);
  const toggleFsRef = useRef(toggleFs);
  toggleFsRef.current = toggleFs;
  useEffect(() => {
    try {
      setFsOk(!!document.fullscreenEnabled && typeof ovRef.current?.requestFullscreen === 'function');
    } catch {
      /* no Fullscreen API */
    }
    const on = () => {
      fsAt.current = performance.now();
      setFsOn(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const cv3Ref = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLElement>(null);
  const placeRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const cdnRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const rScoreRef = useRef<HTMLElement>(null);
  const eng = useRef<Engine | null>(null);
  const phaseRef = useRef<Phase>('loading');
  // The WebGL renderer is created once per page and reused across restarts.
  const glRef = useRef<{ renderer: { dispose(): void } | null }>({ renderer: null });

  const leave = useCallback(() => {
    stopMusic();
    router.push(mode === 'duel' ? '/duels' : '/');
  }, [router, mode]);
  const again = useCallback(() => {
    if (mode === 'duel') {
      router.push('/duels');
      return;
    }
    setNonce((n) => n + 1);
  }, [mode, router]);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const againRef = useRef(again);
  againRef.current = again;

  // Touch pad below the stage on touch devices (or ?pad=1), as in the prototype.
  useEffect(() => {
    let touch = !!forcePad;
    try {
      touch = touch || matchMedia('(pointer:coarse)').matches;
    } catch {
      /* old browser */
    }
    if (touch) document.body.classList.add('touch');
    setMutedState(isMuted());
    return () => document.body.classList.remove('touch');
  }, [forcePad]);
  useEffect(
    () => () => {
      glRef.current.renderer?.dispose();
      glRef.current.renderer = null;
    },
    [],
  );

  // ------------------------------------------------------------------ one run
  useEffect(() => {
    // The live rules until POST /runs answers; then the version the server recorded for this run.
    let def = gameDef(game);
    const cv = cvRef.current!, cv3 = cv3Ref.current!, cvx = cvxRef.current!, stage = stageRef.current!;
    const streamed = STREAMED.includes(mode);
    let alive = true;
    let phaseNow: Phase = 'loading';
    const setPhase = (p: Phase) => {
      phaseNow = p;
      phaseRef.current = p;
      setPhaseState(p);
    };
    setPhase('loading');
    setResult(null);
    setXpOn(false);
    setShare(null);

    let live: LiveRun | null = null;
    let cursor: StreamCursor | null = null;
    let start: StartRunResponse | null = null;
    let scene: Scene3D<unknown> | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let scale = 1;
    const parts = new Particles();
    const acc = new Accumulator();
    const held = newHeld();
    let targets: Targets = { rows: [], best: 0, duel: mode === 'duel' || mode === 'challenge' ? { opp: null, target: null, friend: mode === 'challenge' } : null };
    let raf = 0, last = 0, cd = 1.5, cn = 0, dd = 0, shown = -1, lastBeep = 0;
    let prevTarget: { t: TargetRow | null } | null = null;
    // Display-only juice state.
    const still = reducedMotion();
    let shakeA = 0, shaking = false, dangerS = 0, lastMult = 1, lastCallout = 0, bestShown = false, nextMile = 10;
    let upStreak = 0, lastUp = 0, baseline = 0, cvxOn = false;
    let xctx: CanvasRenderingContext2D | null = null;
    const snap = snapRef.current;
    Object.assign(snap, emptySnap());
    let ws: WebSocket | null = null, wsTries = 0, streaming = false, lastSent = 0, serverSaidEnded = false;
    let streamTimer: ReturnType<typeof setInterval> | undefined;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetry: ReturnType<typeof setTimeout> | undefined;

    const s = () => sref.current;
    const L = () => lref.current;
    const fxText = (text: string) => {
      if (fxRef.current) fxRef.current.textContent = text;
      kick(fxRef.current, 'on');
    };
    const hint = (text: string, show: boolean) => {
      const el = hintRef.current;
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('hide', !show);
    };

    // ---- drawing
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      // The effects layer (speed lines) and, for 3D games, the WebGL buffer follow the stage's size.
      const boxW = stage.getBoundingClientRect().width || W;
      const xw = Math.round(W * clamp((boxW / W) * dpr, 1, 2));
      if (cvx.width !== xw) {
        cvx.width = xw;
        cvx.height = Math.round((xw * H) / W);
      }
      if (def.gl) {
        const r = glRef.current.renderer as { setPixelRatio?(n: number): void; setSize?(w: number, h: number, s: boolean): void } | null;
        r?.setPixelRatio?.(clamp((boxW / W) * dpr, 1, 2.5));
        r?.setSize?.(W, H, false);
        return;
      }
      const cssW = cv.getBoundingClientRect().width || W;
      const want = Math.round(W * clamp((cssW / W) * dpr, 1, 3));
      if (cv.width !== want) {
        cv.width = want;
        cv.height = Math.round((want * H) / W);
      }
      scale = cv.width / W;
      ctx = ctx || cv.getContext('2d');
    };
    const render = () => {
      if (!live) return;
      if (def.gl) scene?.render(live.state);
      else if (ctx && def.draw) {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        def.draw(ctx, live.state, { fxDraw: () => parts.draw(ctx!) });
        if (!def.ownFx) parts.draw(ctx);
      }
    };
    const onResize = () => {
      fit();
      render();
    };

    // ---- HUD (the prototype's target() and hud())
    const target = (sc: number): { t: TargetRow | null; floor: number; place: number } => {
      const d = targets.duel;
      if (d) return { t: d.target != null && sc <= d.target ? { n: d.opp ?? '', s: d.target } : null, floor: 0, place: 0 };
      const list: TargetRow[] = targets.rows.slice();
      if (targets.best > 0) list.push({ n: 'your best', s: targets.best, me: true });
      const above = list.filter((x) => x.s > sc).sort((a, b) => a.s - b.s);
      const below = list.filter((x) => x.s <= sc).sort((a, b) => b.s - a.s);
      return { t: above[0] || null, floor: below[0] ? below[0].s : 0, place: 1 + targets.rows.filter((b) => b.s > sc).length };
    };
    const hud = (force?: boolean) => {
      if (!live) return;
      const sc = live.score;
      if (sc === shown && !force) return;
      const up = sc > shown && shown >= 0;
      shown = sc;
      if (scoreRef.current) scoreRef.current.textContent = fmt(sc);
      if (up) {
        kick(scoreRef.current, 'pop');
        const now = performance.now();
        // Consecutive points climb in pitch (a semitone each, up to an octave); a pause resets the climb.
        upStreak = now - lastUp < 900 ? upStreak + 1 : 0;
        lastUp = now;
        if (now - lastBeep > 70) {
          lastBeep = now;
          beep(520 * Math.pow(2, Math.min(12, upStreak) / 12), 0.05, 'triangle', 0.035);
        }
        // Milestones punch the counter and bump a drum.
        if (sc >= nextMile) {
          while (sc >= nextMile) nextMile = nextMilestone(nextMile);
          kickOnce(scoreRef.current, 'punch');
          drum('kick');
          setTimeout(() => drum('hat', 0.05), 120);
        }
      }
      const old = prevTarget, n = target(sc), d = targets.duel;
      if (!d && !bestShown && targets.best > 0 && sc > targets.best && shown >= 0 && up) {
        bestShown = true;
        if (nbestRef.current) nbestRef.current.textContent = L().t('fx.newBest');
        kickOnce(nbestRef.current, 'on');
        drum('kick', 0.1);
        [659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'square', 0.035), i * 70));
      }
      if (old && old.t && sc > old.t.s && !force) {
        if (!old.t.me) fxText(L().t('fx.passed', { name: old.t.n }));
        beep(784, 0.12, 'sine', 0.06);
        setTimeout(() => beep(1047, 0.16, 'sine', 0.06), 90);
      }
      prevTarget = n;
      const lt = L().t;
      if (placeRef.current) placeRef.current.textContent = mode === 'ranked' || mode === 'cup' ? '#' + n.place : d ? modeTag(lt, d.friend ? 'challenge' : 'duel') : '';
      if (targetRef.current) {
        targetRef.current.textContent = n.t
          ? n.t.me
            ? lt('hud.yourBest', { n: fmt(n.t.s) })
            : lt(d ? 'hud.beat' : 'hud.next', { name: n.t.n, n: fmt(n.t.s) })
          : d
            ? d.opp
              ? lt('hud.ahead', { name: d.opp })
              : lt('hud.setScore')
            : mode !== 'practice'
              ? lt('hud.lead')
              : lt('hud.top');
      }
      const bar = n.t ? clamp((sc - n.floor) / (n.t.s - n.floor), 0, 1) * 100 : 100;
      if (barRef.current) barRef.current.style.width = bar + '%';
      snap.score = sc;
      snap.place = n.place;
      snap.target = targetRef.current?.textContent ?? '';
      snap.bar = bar;
      snap.rows = targets.rows;
      snap.best = targets.best;
      snap.duel = targets.duel;
      snap.pool = targets.pool ?? null;
      snap.endAt = targets.endAt ?? null;
    };

    // ---- juice: popups, callouts, shake, flashes, danger vignette, speed lines (display only)
    const addPop = (x: number, y: number, text: string, big: boolean) => {
      const box = popsRef.current;
      if (!box || box.childElementCount > 10) return;
      const el = document.createElement('span');
      el.className = big ? 'big' : '';
      el.textContent = text;
      el.style.left = (clamp(x, 30, W - 30) / W) * 100 + '%';
      el.style.top = (clamp(y, 40, H - 20) / H) * 100 + '%';
      el.addEventListener('animationend', () => el.remove(), { once: true });
      box.appendChild(el);
    };
    const callout = (text: string) => {
      if (callRef.current) callRef.current.textContent = text;
      kickOnce(callRef.current, 'on');
    };
    const setShake = (tx: number, ty: number) => {
      const v = tx || ty ? `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px)` : '';
      cv.style.transform = v;
      cv3.style.transform = v;
      cvx.style.transform = v;
    };
    const juiceFrame = (fxs: Fx[], delta: number, steps: number, dt: number) => {
      if (!live) return;
      const now = performance.now();
      const v: GameView = def.view?.(live.state) ?? {};
      if (steps > 0) {
        let burst: { x: number; y: number } | null = null;
        for (const f of fxs) {
          if (f.k === 'burst') burst = { x: f.x, y: f.y };
          const a = def.impact?.(f) ?? 0;
          if (a > shakeA) shakeA = a;
          if (a >= 0.5 && !still) kick(hitRef.current, 'on');
        }
        // "+N" where the points were won. Games that also score by time round their bonus to a multiple of 5.
        if (burst && delta > 0) {
          const val = baseline > 0.05 ? Math.round((delta - baseline * steps) / 5) * 5 : delta;
          if (val >= 1) addPop(burst.x, burst.y, '+' + fmt(val), val >= 50);
        } else baseline = baseline * 0.9 + (delta / steps) * 0.1;
      }
      // Combo callouts when the multiplier climbs.
      const mult = v.mult ?? 1;
      if (mult > lastMult && mult >= 2 && now - lastCallout > 900) {
        lastCallout = now;
        callout(L().t('fx.combo', { n: mult }));
        drum('snare', 0.06);
      }
      lastMult = mult;
      // Screen shake.
      shakeA = Math.max(0, shakeA - dt * 3.5);
      if (!still && shakeA > 0.01) {
        setShake((Math.random() - 0.5) * shakeA * 18, (Math.random() - 0.5) * shakeA * 18);
        shaking = true;
      } else if (shaking) {
        setShake(0, 0);
        shaking = false;
      }
      // Danger vignette, pulsing.
      dangerS += ((v.danger ?? 0) - dangerS) * Math.min(1, dt * 8);
      if (vigRef.current) vigRef.current.style.opacity = String(dangerS < 0.02 ? 0 : still ? dangerS * 0.8 : dangerS * (0.72 + 0.28 * Math.sin(now / 85)));
      // Speed lines over the 3D games.
      const sp = v.speed ?? 0;
      if (sp > 0.02) {
        xctx = xctx || cvx.getContext('2d');
        if (xctx) {
          const k = cvx.width / W;
          xctx.setTransform(1, 0, 0, 1, 0, 0);
          xctx.clearRect(0, 0, cvx.width, cvx.height);
          xctx.setTransform(k, 0, 0, k, 0, 0);
          speedLines(xctx, live.state.t, sp, 'down');
          cvxOn = true;
        }
      } else if (cvxOn && xctx) {
        xctx.setTransform(1, 0, 0, 1, 0, 0);
        xctx.clearRect(0, 0, cvx.width, cvx.height);
        cvxOn = false;
      }
      snap.t = live.state.t;
      snap.stats = v.stats ?? [];
    };

    const loadTargets = async (): Promise<Targets> => {
      const myId = s().me?.user.id;
      const fromBoard = (b: BoardResponse): Targets => ({
        rows: b.rows.filter((r) => r.userId !== myId).map((r) => ({ n: r.name, s: r.score })), best: b.me?.score ?? 0, duel: null, pool: b.pool, endAt: b.period.endAt,
      });
      if (mode === 'duel') {
        const d = await api.duels();
        const open = d.open && (!duelId || d.open.id === duelId) ? d.open : null;
        return { rows: [], best: 0, duel: { opp: open?.opponent ?? null, target: open?.target ?? null, friend: false } };
      }
      if (mode === 'challenge') {
        const c = await api.challenge(code ?? '');
        return { rows: [], best: 0, duel: { opp: c.name, target: c.score, friend: true } };
      }
      return fromBoard(mode === 'cup' ? await api.cup() : await api.leaderboard(game));
    };

    // ---- live input stream (ranked, Cup and duel runs)
    const sendChunk = (paused?: boolean) => {
      if (!streaming || !live || !cursor || !ws || ws.readyState !== WebSocket.OPEN) return;
      const c = cursor.next(live.frame);
      if (paused) c.paused = true;
      try {
        ws.send(JSON.stringify(c));
        lastSent = performance.now();
      } catch {
        /* the close handler reconnects */
      }
    };
    const openStream = (again?: boolean) => {
      if (!streamed || !start || !alive) return;
      let sock: WebSocket;
      try {
        sock = new WebSocket(`${wsBase()}/api/runs/${start.runId}/stream?token=${encodeURIComponent(start.streamToken)}`);
      } catch {
        return;
      }
      ws = sock;
      sock.onopen = () => {
        wsTries = 0;
        // After a drop, resend from the last frame the server acknowledged.
        if (again) cursor?.rewind();
        if (streaming) sendChunk(phaseNow === 'pause');
      };
      sock.onmessage = (e) => {
        let m: StreamReply | null = null;
        try {
          m = JSON.parse(String(e.data)) as StreamReply;
        } catch {
          return;
        }
        if (m && 'ok' in m) cursor?.ack(m.to);
        else if (m && 'ended' in m) onServerEnded(m.reason);
      };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        if (!alive || serverSaidEnded || !(phaseNow === 'count' || phaseNow === 'play' || phaseNow === 'pause' || phaseNow === 'loading')) return;
        // Keep playing; finish decides. Try to get the stream back a few times.
        if (wsTries++ < 6) wsRetry = setTimeout(() => openStream(true), 400 + wsTries * 300);
      };
      sock.onerror = () => undefined;
    };
    const closeStream = () => {
      clearInterval(streamTimer);
      clearTimeout(wsRetry);
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch {
        /* already closed */
      }
    };
    /** The server ended the run itself (stream stalled, paused too long, or the stream was refused). */
    const onServerEnded = (reason: string) => {
      if (serverSaidEnded) return;
      serverSaidEnded = true;
      if (phaseNow === 'play' || phaseNow === 'pause' || phaseNow === 'count') {
        stopMusic();
        s().toast(L().t('ended', { reason: L().errs.reason(reason) }));
        void finish();
      }
    };

    // ---- phases
    const begin = () => {
      setPhase('play');
      acc.reset();
      cdnRef.current?.classList.remove('on');
      fxText(L().t('fx.go'));
      beep(880, 0.2, 'square', 0.05);
      startMusic(g.song, () => phaseNow === 'play');
      hintTimer = setTimeout(() => hintRef.current?.classList.add('hide'), 2600);
      if (streamed) {
        streaming = true;
        sendChunk();
        streamTimer = setInterval(() => {
          const since = performance.now() - lastSent;
          if (phaseNow === 'play' && since >= 1000) sendChunk();
          else if (phaseNow === 'pause' && since >= 1500) sendChunk(true);
        }, 250);
      }
    };
    const handleFx = (list: Fx[]) => {
      for (const f of list) {
        if (f.k === 'burst') parts.burst(f.x, f.y, f.c, f.n, f.sp);
        else if (f.k === 'beep') beep(f.f, f.d, f.w, f.v, f.slide);
        else if (f.k === 'text') fxText(L().content.fx(f.t));
      }
    };
    const die = () => {
      stopMusic();
      setPhase('dying');
      dd = 0.7;
      shakeA = 0;
      setShake(0, 0);
      if (vigRef.current) vigRef.current.style.opacity = '0';
      kick(stage, 'shake');
      kick(flashRef.current, 'on');
      beep(260, 0.4, 'sawtooth', 0.07, -200);
      try {
        navigator.vibrate?.(60);
      } catch {
        /* not supported */
      }
      sendChunk();
    };
    const loop = (now: number) => {
      if (!alive || !live) return;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (phaseNow === 'count') {
        cd -= dt;
        const n = Math.ceil(cd / 0.5);
        if (n !== cn && n > 0) {
          cn = n;
          if (cdnRef.current) cdnRef.current.textContent = String(n);
          kick(cdnRef.current, 'tick');
          beep(440, 0.09, 'square', 0.04);
        }
        if (cd <= 0) begin();
      } else if (phaseNow === 'play') {
        const steps = acc.add(dt);
        const before = live.score, fxs: Fx[] = [];
        for (let i = 0; i < steps && !live.dead; i++) {
          const list = live.step();
          handleFx(list);
          fxs.push(...list);
        }
        parts.step(dt);
        render();
        juiceFrame(fxs, live.score - before, steps, dt);
        hud();
        if (live.dead) die();
      } else if (phaseNow === 'dying') {
        dd -= dt;
        if (dd <= 0) void finish();
      }
      if (phaseNow === 'count' || phaseNow === 'play' || phaseNow === 'pause' || phaseNow === 'dying') raf = requestAnimationFrame(loop);
    };
    const pause = (on: boolean) => {
      if (!live) return;
      if (on && phaseNow === 'play') {
        setPhase('pause');
        sendChunk(true);
      } else if (!on && phaseNow === 'pause') {
        // Nothing may stay stuck across a pause.
        for (const [c, v] of releaseAllEvents(held)) live.push(c, v);
        last = performance.now();
        acc.reset();
        setPhase('play');
      }
    };
    const push = (evs: EvPair[]) => {
      if (phaseNow !== 'play' || !live) return;
      for (const [c, v] of evs) live.push(c, v);
    };

    // ---- finish: the server replays the inputs and its answer is what is shown
    const finish = async () => {
      if (!live || !start || phaseNow === 'saving' || phaseNow === 'over') return;
      setPhase('saving');
      stopMusic();
      const run = live, st = start;
      const body = { score: run.score, frames: run.frame, inputLog: logUpTo(run.log, run.frame) };
      const slow = setTimeout(() => alive && hint(L().t('saving'), true), 900);
      let res: FinishRunResponse | null = null, err: unknown = null;
      for (let attempt = 0; attempt < 4 && alive; attempt++) {
        try {
          res = await api.finishRun(st.runId, body);
          err = null;
          break;
        } catch (e) {
          err = e;
          // Only a network error is retried (with the same Idempotency-Key).
          if (!(e instanceof ApiFailure && e.code === 'network')) break;
          await sleep(1200);
        }
      }
      clearTimeout(slow);
      closeStream();
      if (!alive) return;
      hint('', false);
      const u = s().me?.user;
      const lt = L().t;
      if (!res) {
        const lv = u?.level ?? 1, xp = u?.xp ?? 0;
        setResult({
          title: titleFor(lt, mode, targets.duel?.opp ?? null), score: run.score, badges: [{ c: '', t: lt('notRecorded') }],
          info: err instanceof ApiFailure && err.code === 'run_rejected' ? lt('rejected', { reason: L().errs.reason(err.message) }) : L().errs.text(err),
          rows: [], level: lv, xpPct: pct(xp, lv), xpToGo: Math.max(0, levelCeil(lv) - xp), again: lt('again'), runId: null, shareLine: '', cheer: false,
        });
        setPhase('over');
        void s().refresh();
        return;
      }
      s().patchUser({ balance: res.user.balance, xp: res.user.xp, level: res.user.level, boxes: res.user.boxes });
      const best = res.newBest ? res.score : targets.best;
      setResult(buildResult(lt, res, best, targets));
      setPhase('over');
      for (const id of res.missionsCompleted) {
        const m = missionDef(id);
        if (m) s().toast(lt('missionDone', { title: L().content.mission(m.id, m.title) }));
      }
      void s().refresh();
      // The line under the badges names the next player to pass; that needs the fresh board.
      if ((mode === 'ranked' || mode === 'cup') && res.place > 0 && res.status === 'finished') {
        try {
          const b = mode === 'cup' ? await api.cup() : await api.leaderboard(game);
          const paid = mode === 'cup' ? CUP_WINNERS : WEEKLY_WINNERS;
          const mine = b.me?.score ?? best, place = b.me?.place ?? res.place;
          const nx = b.rows.find((r) => r.place === place - 1);
          if (alive && place > paid && nx) {
            const line = lt('toPass', { n: fmt(nx.score - mine + 1), name: nx.name, best: fmt(mine) });
            setResult((r) => (r && r.runId === res!.runId ? { ...r, info: line } : r));
          }
        } catch {
          /* the simpler line stays */
        }
      }
    };

    // ---- input listeners
    const onKeyDown = (e: KeyboardEvent) => {
      if (shareOpen.current) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.('button,a,input');
      // F toggles full screen. Escape while in full screen (or just after leaving it) only leaves full
      // screen, which the browser does by itself: it must not also pause or leave the game.
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement | null)?.closest?.('input')) {
        toggleFsRef.current();
        return;
      }
      const fsEsc = e.code === 'Escape' && (!!document.fullscreenElement || performance.now() - fsAt.current < 600);
      if (phaseNow === 'over') {
        if (e.repeat) return;
        if (e.code === 'KeyM') return eng.current?.toggleMute();
        if ((e.code === 'Space' || e.code === 'Enter') && !onControl) {
          e.preventDefault();
          againRef.current();
        } else if (e.code === 'Escape' && !fsEsc) leaveRef.current();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code) && (phaseNow === 'play' || !onControl)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyM') return eng.current?.toggleMute();
      if (fsEsc) return;
      if (e.code === 'Escape' || e.code === 'KeyP') return pause(phaseNow === 'play');
      if (phaseNow !== 'play') return;
      push(keyDownEvents(e.code, held));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const evs = keyUpEvents(e.code, held);
      push(evs);
    };
    const px = (e: PointerEvent) => {
      const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return ((e.clientX - b.left) / b.width) * W;
    };
    const onPtrDown = (e: PointerEvent) => {
      if (phaseNow !== 'play') return;
      push(pointerDownEvents(px(e), !!def.mid, held));
    };
    const onPtrMove = (e: PointerEvent) => {
      if (held.ptr) push(pointerMoveEvents(px(e), held));
    };
    const onPtrUp = () => {
      const evs = pointerUpEvents(held);
      push(evs);
    };
    const onBlur = () => pause(true);
    const onVis = () => document.hidden && pause(true);
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    addEventListener('pointerup', onPtrUp);
    addEventListener('pointercancel', onPtrUp);
    addEventListener('resize', onResize);
    for (const c of [cv, cv3]) {
      c.addEventListener('pointerdown', onPtrDown);
      c.addEventListener('pointermove', onPtrMove);
    }

    eng.current = {
      pause,
      toggleMute() {
        const m = !isMuted();
        setMuted(m);
        setMutedState(m);
        if (!m) {
          beep(660, 0.08, 'sine', 0.05);
          if (phaseNow === 'play' || phaseNow === 'pause') startMusic(g.song, () => phaseNow === 'play');
        } else stopMusic();
      },
      pad(k, down) {
        const evs = down ? (phaseNow === 'play' ? padDownEvents(k, held) : []) : padUpEvents(k, held);
        push(evs);
      },
    };

    // ---- start (deferred one tick so a development double-mount cannot start two runs)
    const boot = setTimeout(async () => {
      cv.style.display = def.gl ? 'none' : 'block';
      cv3.style.display = def.gl ? 'block' : 'none';
      cdnRef.current?.classList.remove('on');
      stage.classList.remove('shake');
      setShake(0, 0);
      if (vigRef.current) vigRef.current.style.opacity = '0';
      if (popsRef.current) popsRef.current.textContent = '';
      hint(L().gc.keys, true);
      if (scoreRef.current) scoreRef.current.textContent = '0';
      try {
        // A visitor who lands here directly has no session yet: practice starts as a guest.
        if (!s().me) {
          if (mode !== 'practice') {
            s().toast(L().t('guestOnly'));
            s().openSignIn();
            leaveRef.current();
            return;
          }
          await api.guest();
          await s().refresh();
          if (!alive) return;
        }
        if (def.gl) {
          try {
            const [THREE, g3] = await Promise.all([import('three'), import('@/game3d')]);
            if (!alive) return;
            let renderer = glRef.current.renderer as InstanceType<typeof THREE.WebGLRenderer> | null;
            if (!renderer) {
              renderer = new THREE.WebGLRenderer({ canvas: cv3, antialias: true });
              renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
              renderer.setSize(W, H, false);
              glRef.current.renderer = renderer;
            }
            scene = g3.createScene3D(game, renderer);
            if (!scene) throw new Error('no scene');
          } catch {
            if (alive) {
              s().toast(L().t('no3d'));
              leaveRef.current();
            }
            return;
          }
        }
        // The card comes before POST /runs: the run (and the server's clock for it) starts only once it is dismissed.
        if (!tutorialSeen(game)) {
          await new Promise<void>((resolve) => {
            tutDone.current = resolve;
            setTut(true);
          });
          if (!alive) return;
        }
        const targetsP = loadTargets().catch(() => null);
        start = await api.startRun({ game, mode, ...(duelId ? { duelId } : {}), ...(code ? { challengeCode: code } : {}) });
        if (!alive) return;
        s().patchUser({ balance: start.balance, freePractice: start.freePractice });
        const t = await Promise.race([targetsP, sleep(1500).then(() => null)]);
        if (!alive) return;
        if (t) targets = t;
        else
          void targetsP.then((late) => {
            if (late && alive) {
              targets = late;
              prevTarget = null;
              hud(true);
            }
          });
        // Play the rules version the server recorded for this run, so its replay agrees with this one.
        def = gameDefVersion(game, start.gameVersion);
        live = new LiveRun(def, start.seed);
        nextMile = 10;
        bestShown = false;
        snap.stats = def.view?.(live.state).stats ?? [];
        cursor = new StreamCursor(live.log);
        parts.clear();
        fit();
        render();
        hud(true);
        openStream();
        cd = 1.5;
        cn = 0;
        cdnRef.current && (cdnRef.current.textContent = '');
        cdnRef.current?.classList.add('on');
        setPhase('count');
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (!alive) return;
        s().fail(e);
        if (e instanceof ApiFailure && (e.code === 'guest_not_allowed' || e.code === 'unauthorized')) s().openSignIn();
        leaveRef.current();
      }
    }, 0);

    return () => {
      alive = false;
      clearTimeout(boot);
      clearTimeout(hintTimer);
      cancelAnimationFrame(raf);
      closeStream();
      stopMusic();
      eng.current = null;
      scene?.dispose();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointerup', onPtrUp);
      removeEventListener('pointercancel', onPtrUp);
      removeEventListener('resize', onResize);
      for (const c of [cv, cv3]) {
        c.removeEventListener('pointerdown', onPtrDown);
        c.removeEventListener('pointermove', onPtrMove);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, mode, duelId, code, nonce]);

  // ---- result: count-up, XP bar, chime
  useEffect(() => {
    if (!result) return;
    const el = rScoreRef.current, to = result.score, t0 = performance.now(), d = 650;
    let raf = 0;
    const f = (now: number) => {
      const p = Math.min(1, (now - t0) / d);
      if (el) el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(f);
      else if (el) el.textContent = fmt(to);
    };
    raf = requestAnimationFrame(f);
    const x = setTimeout(() => setXpOn(true), 30);
    if (result.cheer) {
      beep(659, 0.12, 'sine', 0.06);
      setTimeout(() => beep(988, 0.22, 'sine', 0.06), 110);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(x);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.runId, result?.score, result?.title]);

  // ---- share card
  const openShare = async () => {
    if (!result || sharing) return;
    setSharing(true);
    const me = sref.current.me;
    const ref = me?.user.refCode ? `?ref=${encodeURIComponent(me.user.refCode)}` : '';
    let link = `${location.origin}/${ref}`;
    if (result.runId) {
      try {
        const { code: c } = await api.createChallenge(result.runId);
        link = `${location.origin}/c/${encodeURIComponent(c)}${ref}`;
      } catch {
        /* guests and unrecorded runs share the plain link */
      }
    }
    const img = await renderShareCard({
      gameKey: game,
      gameName: g.name,
      score: result.score,
      line: result.shareLine,
      playerName: me?.user.name ?? t('guest'),
      level: me?.user.level ?? 1,
      levelText: t('card.level', { n: me?.user.level ?? 1 }),
      cta: t('card.cta'),
    });
    setShare({ img, link });
    setSharing(false);
  };
  const copyLink = (text: string) => {
    const bad = () => sref.current.toast(tc('copy.linkFail'));
    try {
      navigator.clipboard.writeText(text).then(() => sref.current.toast(t('linkCopied')), bad);
    } catch {
      bad();
    }
  };
  useEffect(() => {
    if (!share) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setShare(null);
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [share]);

  const cost = runCost(mode, session.me, !!session.chain);
  const pad = g.pad || 'lr';
  const padBtn = (k: 'l' | 'r' | 'a') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      eng.current?.pad(k, true);
    },
    onPointerUp: () => eng.current?.pad(k, false),
    onPointerCancel: () => eng.current?.pad(k, false),
    onPointerLeave: () => eng.current?.pad(k, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <>
      <div className={`scrim on ${fsOn ? 'fs' : ''}`} id="ov" ref={ovRef}>
        <div className="bg" id="oBg" aria-hidden="true">
          <Cover game={game} eager />
        </div>
        <PlaySide side="l" game={game} mode={mode} snap={snapRef} />
        <div className="stage" id="stage" ref={stageRef}>
          <canvas id="cv" width={W} height={H} ref={cvRef} aria-label={t('canvas', { game: g.name })} />
          <canvas id="cv3" width={W} height={H} ref={cv3Ref} aria-label={t('canvas', { game: g.name })} />
          <canvas id="cvx" width={W} height={H} ref={cvxRef} aria-hidden="true" />
          <div className="vig" ref={vigRef} aria-hidden="true" />
          <div className="hitfl" ref={hitRef} aria-hidden="true" />
          <div className="pops" ref={popsRef} aria-hidden="true" />
          <div className="callout" ref={callRef} aria-hidden="true" />
          <div className="nbest" ref={nbestRef} aria-live="polite" />
          <div className="flash" id="flash" ref={flashRef} />
          <div className="gtop">
            <button className="gb" id="quit" aria-label={phase === 'pause' ? t('resume') : t('pause')} onClick={() => eng.current?.pause(phaseRef.current === 'play')}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="4" width="3.4" height="12" rx="1.2" />
                <rect x="11.6" y="4" width="3.4" height="12" rx="1.2" />
              </svg>
            </button>
            <div className="gname">
              <b id="oName">{g.name}</b>
              <span id="oMode" className={mode !== 'practice' ? 'rk' : ''}>
                {modeTag(t, mode)}
              </span>
            </div>
            {fsOk && (
              <button className="gb fsb" id="fsb" aria-label={fsOn ? t('exitFullscreen') : t('fullscreen')} aria-pressed={fsOn} onClick={toggleFs}>
                <svg className="st" viewBox="0 0 20 20" aria-hidden="true">
                  {fsOn ? <path d="M8 3.5V8H3.5M12 3.5V8h4.5M8 16.5V12H3.5M12 16.5V12h4.5" /> : <path d="M3.5 8V3.5H8M16.5 8V3.5H12M3.5 12v4.5H8M16.5 12v4.5H12" />}
                </svg>
              </button>
            )}
            <button className={`gb ${muted ? 'off' : ''}`} id="mute" aria-label={muted ? t('soundOn') : t('soundOff')} aria-pressed={!muted} onClick={() => eng.current?.toggleMute()}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 8h3l4-3.5v11L6 12H3z" />
                <path id="muteW" d="M13 7.5a4 4 0 0 1 0 5M15.2 5.4a7 7 0 0 1 0 9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="gscore">
            <b className="num" id="oScore" ref={scoreRef}>
              0
            </b>
            <div className="gt">
              <span className="pl" id="oPlace" ref={placeRef} />
              <span id="oTarget" ref={targetRef} />
            </div>
            <i className="gbar">
              <u id="oBar" ref={barRef} />
            </i>
          </div>
          <div className="fx" id="fx" ref={fxRef} aria-live="polite" />
          <div className="count" id="cdn" ref={cdnRef} />
          <div className="ghint" id="oKeys" ref={hintRef}>
            {gc.keys}
          </div>
          {tut && phase === 'loading' && <TutorialCard game={game} onDone={closeTut} />}
          <div className={`veil pause ${phase === 'pause' ? 'on' : ''}`} id="pauseP">
            <div className="rc">
              <h3>{t('paused')}</h3>
              <button className="btn go" id="resume" onClick={() => eng.current?.pause(false)}>
                {t('resume')}
                <kbd>Esc</kbd>
              </button>
              {mode !== 'duel' && mode !== 'challenge' && (
                <button className="btn alt" id="restart" onClick={again}>
                  {t('restart')} <kbd>{t('cost', { n: cost })}</kbd>
                </button>
              )}
              <button className="btn alt" id="leave" onClick={leave}>
                {t('leave')}
              </button>
              {STREAMED.includes(mode) && <div className="hint">{t('pauseLimit', { mode: modeTag(t, mode).toLowerCase(), n: Math.round(ANTI_ABUSE.maxBehindMs / 1000) })}</div>}
            </div>
          </div>
          <div className={`veil result ${phase === 'over' && result ? 'on' : ''}`} id="panel">
            {result && (
              <div className="rc">
                <small id="rTitle">{result.title}</small>
                <b className="num sc" id="rScore" ref={rScoreRef}>
                  0
                </b>
                <div className="badges" id="rBadges">
                  {result.badges.map((b, i) => (
                    <span key={i} className={b.c}>
                      {b.t}
                    </span>
                  ))}
                </div>
                <p id="rInfo">{result.info}</p>
                <table>
                  <tbody id="rBoard">
                    {result.rows.map((x) => (
                      <tr key={x.place + x.name} className={x.me ? 'me' : ''}>
                        <td>{x.place}</td>
                        <td>{x.name}</td>
                        <td className="r">
                          <b className="num">{fmt(x.score)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="xp">
                  <span id="rLv">{t('level', { n: result.level })}</span>
                  <i>
                    <u id="rXp" style={{ width: xpOn ? `${result.xpPct}%` : '0%' }} />
                  </i>
                  <span id="rXpT">{t('xpToGo', { n: fmt(result.xpToGo) })}</span>
                </div>
                <div className="cta">
                  <button className="btn go" id="again" onClick={again}>
                    {result.again}
                    <kbd>{t('kbd.space')}</kbd>
                  </button>
                  <button className="btn alt" id="close" onClick={leave}>
                    {t('back')}
                    <kbd>Esc</kbd>
                  </button>
                </div>
                <button className="lnk" id="shareB" onClick={openShare} disabled={sharing}>
                  {t('share')}
                </button>
              </div>
            )}
          </div>
        </div>
        <PlaySide side="r" game={game} mode={mode} snap={snapRef} />
        <div className="pad" id="pad">
          {pad !== 'a' && (
            <button aria-label={t('left')} {...padBtn('l')}>
              {ARROW(-1)}
            </button>
          )}
          {pad !== 'lr' && (
            <button className="act" {...padBtn('a')}>
              {gc.act || t('fx.go')}
            </button>
          )}
          {pad !== 'a' && (
            <button aria-label={t('right')} {...padBtn('r')}>
              {ARROW(1)}
            </button>
          )}
        </div>
      </div>
      {share && result && (
        <div className="scrim on" id="share" role="dialog" aria-modal="true" aria-label={t('share')} onClick={(e) => e.target === e.currentTarget && setShare(null)}>
          <div className="sheet" style={{ position: 'relative' }}>
            <button className="x" aria-label={tc('close')} onClick={() => setShare(null)}>
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img id="shImg" alt={share.img ? t('shareImg') : t('shareBlocked')} src={share.img ?? undefined} />
            <div className="row">
              <a className="btn go" id="shDl" href={share.img ?? '#'} download={`${BRAND.name.toLowerCase()}-${game}-${result.score}.png`}>
                {t('download')}
              </a>
              <button
                className="btn alt"
                id="shX"
                onClick={() =>
                  window.open(
                    'https://x.com/intent/post?text=' + encodeURIComponent(t('tweet', { score: fmt(result.score), game: g.name, brand: BRAND.name })) + '&url=' + encodeURIComponent(share.link),
                    '_blank',
                    'noopener',
                  )
                }
              >
                {t('postX')}
              </button>
              <button className="btn alt" id="shCopy" onClick={() => copyLink(share.link)}>
                {t('copyLink')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const pct = (xp: number, lv: number): number => {
  const base = levelFloor(lv), next = levelCeil(lv);
  return next > base ? clamp(((xp - base) / (next - base)) * 100, 0, 100) : 0;
};

function titleFor(t: PlayT, mode: RunMode, opp: string | null): string {
  if (mode === 'ranked') return t('title.ranked');
  if (mode === 'cup') return t('title.cup', { brand: BRAND.name });
  if (mode === 'duel') return opp ? t('title.duelVs', { name: opp }) : t('title.duel');
  if (mode === 'challenge') return opp ? t('title.challengeFrom', { name: opp }) : t('title.challenge');
  return t('title.practice');
}

/** Turns the server's answer into the prototype's result screen. Nothing here is computed from the local run. */
function buildResult(t: PlayT, res: FinishRunResponse, best: number, targets: Targets): ResultView {
  const { mode, score: sc, place } = res;
  const cup = mode === 'cup';
  const B: { c: string; t: string }[] = [];
  const has = (b: FinishRunResponse['badges'][number]) => res.badges.includes(b);
  let info = t('info.practice');
  let rows = res.top5;
  let again = t('again');
  let shareLine = t('title.practice');
  let cheer = res.newBest;
  let opp: string | null = targets.duel?.opp ?? null;
  const xpBadge = () => res.xpGained > 0 && B.push({ c: 'b2', t: t('badge.xp', { n: res.xpGained }) });

  if (res.rewardsHeld || has('held')) {
    B.push({ c: '', t: t('badge.held') });
    info = t('info.held');
    shareLine = t('share.modeRun', { mode: modeTag(t, mode) });
  } else if (mode === 'ranked' || cup) {
    const paid = cup ? CUP_WINNERS : WEEKLY_WINNERS;
    if (res.newBest) B.push({ c: 'b1', t: t('badge.newBest') });
    if (place) B.push({ c: '', t: t('badge.place', { n: place }) });
    if (place && place <= paid) B.push({ c: 'b3', t: t('badge.prize') });
    xpBadge();
    if (res.boxDropped) B.push({ c: 'b3', t: t('badge.box') });
    if (place && place <= paid) info = t(cup ? 'info.holdCup' : 'info.holdWeek', { place, n: fmt(res.prizeIfHeld) });
    else if (place) info = t('info.best', { n: fmt(Math.max(best, res.newBest ? sc : 0)) });
    else info = t('info.atLeast1');
    shareLine = place ? t('share.placeWeek', { n: place }) : t('title.ranked');
  } else if (mode === 'duel' && res.duel) {
    const d = res.duel;
    opp = d.opponent ?? opp;
    if (d.won === null) {
      B.push({ c: '', t: t('badge.waiting') });
      info = t('info.waiting', { h: ECONOMY.duelExpiryHours });
      rows = [{ place: 1, name: t('you'), score: sc, me: true }];
      shareLine = t('title.duel');
    } else {
      const ts = d.opponentScore ?? 0, o = d.opponent ?? t('yourOpp');
      if (d.won) {
        B.push({ c: 'b1', t: t('badge.duelWon') }, { c: 'b3', t: t('badge.chips', { n: fmt(d.payout) }) });
        info = t('info.duelWon', { name: o, n: fmt(ts) });
      } else {
        B.push({ c: '', t: t('badge.duelLost') });
        info = t('info.lost', { name: o, n: fmt(ts), k: fmt(Math.max(1, ts - sc + 1)) });
      }
      cheer = d.won;
      shareLine = d.won ? t('badge.duelWon') : t('badge.duelLost');
      if (!rows.length)
        rows = [
          { name: t('you'), score: sc, me: true },
          { name: o, score: ts, me: false },
        ]
          .sort((a, b) => b.score - a.score || Number(a.me) - Number(b.me))
          .map((r, i) => ({ place: i + 1, ...r }));
    }
    xpBadge();
    again = t('rematch');
  } else if (mode === 'challenge' && res.challenge) {
    const c = res.challenge;
    opp = c.opponent || opp;
    B.push(c.won ? { c: 'b1', t: t('badge.chalWon') } : { c: '', t: t('badge.chalLost') });
    info = c.won ? t('info.chalWon', { name: c.opponent, n: fmt(c.target) }) : t('info.lost', { name: c.opponent, n: fmt(c.target), k: fmt(Math.max(1, c.target - sc + 1)) });
    xpBadge();
    cheer = c.won;
    again = t('tryAgain');
    shareLine = c.won ? t('badge.chalWon') : t('badge.chalLost');
  } else {
    B.push({ c: '', t: t('notRecorded') });
    // Practice shows the board as it stood when the run started (display only).
    if (!rows.length) {
      const list = targets.rows.map((r) => ({ name: r.n, score: r.s, me: false }));
      if (targets.best > 0) list.push({ name: t('you'), score: targets.best, me: true });
      rows = list.sort((a, b) => b.score - a.score).slice(0, 5).map((r, i) => ({ place: i + 1, ...r }));
    }
  }
  const lv = res.user.level, xp = res.user.xp;
  return {
    title: titleFor(t, mode, opp), score: sc, badges: B, info, rows, level: lv, xpPct: pct(xp, lv), xpToGo: Math.max(0, levelCeil(lv) - xp), again,
    runId: res.status === 'finished' ? res.runId : null, shareLine, cheer,
  };
}
