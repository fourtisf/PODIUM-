'use client';
// The immersive in-game stage (the prototype's #ov overlay) as its own page.
// Flow: POST /runs (the server charges the entry) -> 3-2-1 -> play at a fixed 60 Hz step while
// streaming inputs -> death (0.7 s shake and flash) -> POST finish -> result from the server.
// The browser only displays: the score, place, XP and prizes on the result come from the response.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { H, LiveRun, Particles, W, gameDef } from '@podium/games';
import type { Fx } from '@podium/games';
import { ANTI_ABUSE, BRAND, CUP_WINNERS, ECONOMY, GAMES, WEEKLY_WINNERS, fmt, levelCeil, levelFloor, missionDef } from '@podium/shared';
import type { BoardResponse, FinishRunResponse, GameKey, RunMode, StartRunResponse, StreamReply } from '@podium/shared';
import { ApiFailure, api, errorText, wsBase } from '@/lib/api';
import { beep, isMuted, setMuted, startMusic, stopMusic } from '@/lib/audio';
import {
  Accumulator, StreamCursor, keyDownEvents, keyUpEvents, logUpTo, newHeld, padDownEvents, padUpEvents, pointerDownEvents, pointerMoveEvents,
  pointerUpEvents, releaseAllEvents, type EvPair,
} from '@/lib/recorder';
import { renderShareCard } from '@/lib/sharecard';
import type { Scene3D } from '@/game3d/types';
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
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const STREAMED: RunMode[] = ['ranked', 'cup', 'duel'];
const MODE_TAG: Record<RunMode, string> = { ranked: 'Ranked', cup: 'Cup', duel: 'Duel', challenge: 'Challenge', practice: 'Practice' };

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

  const stageRef = useRef<HTMLDivElement>(null);
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
    const def = gameDef(game);
    const cv = cvRef.current!, cv3 = cv3Ref.current!, stage = stageRef.current!;
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
    let ws: WebSocket | null = null, wsTries = 0, streaming = false, lastSent = 0, serverSaidEnded = false;
    let streamTimer: ReturnType<typeof setInterval> | undefined;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetry: ReturnType<typeof setTimeout> | undefined;

    const s = () => sref.current;
    const fxText = (t: string) => {
      if (fxRef.current) fxRef.current.textContent = t;
      kick(fxRef.current, 'on');
    };
    const hint = (t: string, show: boolean) => {
      const el = hintRef.current;
      if (!el) return;
      el.textContent = t;
      el.classList.toggle('hide', !show);
    };

    // ---- drawing
    const fit = () => {
      if (def.gl) return;
      const dpr = window.devicePixelRatio || 1;
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
        if (now - lastBeep > 70) {
          lastBeep = now;
          beep(520 + Math.min(500, (sc % 24) * 18), 0.05, 'triangle', 0.035);
        }
      }
      const old = prevTarget, n = target(sc), d = targets.duel;
      if (old && old.t && sc > old.t.s && !force) {
        fxText(old.t.me ? 'New personal best' : 'Passed ' + old.t.n);
        beep(784, 0.12, 'sine', 0.06);
        setTimeout(() => beep(1047, 0.16, 'sine', 0.06), 90);
      }
      prevTarget = n;
      if (placeRef.current) placeRef.current.textContent = mode === 'ranked' || mode === 'cup' ? '#' + n.place : d ? (d.friend ? 'Challenge' : 'Duel') : '';
      if (targetRef.current) {
        targetRef.current.textContent = n.t
          ? (n.t.me ? 'Your best ' : d ? 'Beat ' + n.t.n + ' ' : 'Next ' + n.t.n + ' ') + fmt(n.t.s)
          : d
            ? d.opp
              ? 'Ahead of ' + d.opp
              : 'Set the score to beat'
            : mode !== 'practice'
              ? 'You lead the board'
              : 'Top of the board';
      }
      if (barRef.current) barRef.current.style.width = (n.t ? clamp((sc - n.floor) / (n.t.s - n.floor), 0, 1) * 100 : 100) + '%';
    };

    const loadTargets = async (): Promise<Targets> => {
      const myId = s().me?.user.id;
      const fromBoard = (b: BoardResponse): Targets => ({ rows: b.rows.filter((r) => r.userId !== myId).map((r) => ({ n: r.name, s: r.score })), best: b.me?.score ?? 0, duel: null });
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
        s().toast(`The run was ended: ${reason}.`);
        void finish();
      }
    };

    // ---- phases
    const begin = () => {
      setPhase('play');
      acc.reset();
      cdnRef.current?.classList.remove('on');
      fxText('Go');
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
        else if (f.k === 'text') fxText(f.t);
      }
    };
    const die = () => {
      stopMusic();
      setPhase('dying');
      dd = 0.7;
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
        for (let i = 0; i < steps && !live.dead; i++) handleFx(live.step());
        parts.step(dt);
        render();
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
      const slow = setTimeout(() => alive && hint('Saving your score', true), 900);
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
      if (!res) {
        const lv = u?.level ?? 1, xp = u?.xp ?? 0;
        setResult({
          title: titleFor(mode, targets.duel?.opp ?? null), score: run.score, badges: [{ c: '', t: 'Not recorded' }],
          info: err instanceof ApiFailure && err.code === 'run_rejected' ? `This run was not accepted: ${err.message}.` : errorText(err),
          rows: [], level: lv, xpPct: pct(xp, lv), xpToGo: Math.max(0, levelCeil(lv) - xp), again: 'Play again', runId: null, shareLine: '', cheer: false,
        });
        setPhase('over');
        void s().refresh();
        return;
      }
      s().patchUser({ balance: res.user.balance, xp: res.user.xp, level: res.user.level, boxes: res.user.boxes });
      const best = res.newBest ? res.score : targets.best;
      setResult(buildResult(res, best, targets));
      setPhase('over');
      for (const id of res.missionsCompleted) {
        const m = missionDef(id);
        if (m) s().toast('Mission complete: ' + m.title);
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
            const line = `${fmt(nx.score - mine + 1)} more points to pass ${nx.name}. Your best is ${fmt(mine)}.`;
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
      if (phaseNow === 'over') {
        if (e.repeat) return;
        if (e.code === 'KeyM') return eng.current?.toggleMute();
        if ((e.code === 'Space' || e.code === 'Enter') && !onControl) {
          e.preventDefault();
          againRef.current();
        } else if (e.code === 'Escape') leaveRef.current();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code) && (phaseNow === 'play' || !onControl)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyM') return eng.current?.toggleMute();
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
      hint(g.keys, true);
      if (scoreRef.current) scoreRef.current.textContent = '0';
      try {
        // A visitor who lands here directly has no session yet: practice starts as a guest.
        if (!s().me) {
          if (mode !== 'practice') {
            s().toast('Sign in to do that. Guests can play practice only.');
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
              s().toast("The 3D game couldn't load in this browser.");
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
        live = new LiveRun(def, start.seed);
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
    const img = await renderShareCard({ gameKey: game, gameName: g.name, score: result.score, line: result.shareLine, playerName: me?.user.name ?? 'Guest', level: me?.user.level ?? 1 });
    setShare({ img, link });
    setSharing(false);
  };
  const copyLink = (t: string) => {
    const bad = () => sref.current.toast('Copy failed. Select the link and copy it manually.');
    try {
      navigator.clipboard.writeText(t).then(() => sref.current.toast('Challenge link copied.'), bad);
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
      <div className="scrim on" id="ov">
        <div className="bg" id="oBg" aria-hidden="true">
          <Cover game={game} eager />
        </div>
        <div className="stage" id="stage" ref={stageRef}>
          <canvas id="cv" width={W} height={H} ref={cvRef} aria-label={`${g.name} game`} />
          <canvas id="cv3" width={W} height={H} ref={cv3Ref} aria-label={`${g.name} game`} />
          <div className="flash" id="flash" ref={flashRef} />
          <div className="gtop">
            <button className="gb" id="quit" aria-label={phase === 'pause' ? 'Resume' : 'Pause'} onClick={() => eng.current?.pause(phaseRef.current === 'play')}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="4" width="3.4" height="12" rx="1.2" />
                <rect x="11.6" y="4" width="3.4" height="12" rx="1.2" />
              </svg>
            </button>
            <div className="gname">
              <b id="oName">{g.name}</b>
              <span id="oMode" className={mode !== 'practice' ? 'rk' : ''}>
                {MODE_TAG[mode]}
              </span>
            </div>
            <button className={`gb ${muted ? 'off' : ''}`} id="mute" aria-label={muted ? 'Turn sound on' : 'Turn sound off'} aria-pressed={!muted} onClick={() => eng.current?.toggleMute()}>
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
            {g.keys}
          </div>
          {tut && phase === 'loading' && <TutorialCard game={game} onDone={closeTut} />}
          <div className={`veil pause ${phase === 'pause' ? 'on' : ''}`} id="pauseP">
            <div className="rc">
              <h3>Paused</h3>
              <button className="btn go" id="resume" onClick={() => eng.current?.pause(false)}>
                Resume<kbd>Esc</kbd>
              </button>
              {mode !== 'duel' && mode !== 'challenge' && (
                <button className="btn alt" id="restart" onClick={again}>
                  Restart <kbd>{cost} tChips</kbd>
                </button>
              )}
              <button className="btn alt" id="leave" onClick={leave}>
                Leave game
              </button>
              {STREAMED.includes(mode) && <div className="hint">A {MODE_TAG[mode].toLowerCase()} run ends after {Math.round(ANTI_ABUSE.maxBehindMs / 1000)} seconds of pause in total.</div>}
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
                  <span id="rLv">Level {result.level}</span>
                  <i>
                    <u id="rXp" style={{ width: xpOn ? `${result.xpPct}%` : '0%' }} />
                  </i>
                  <span id="rXpT">{fmt(result.xpToGo)} XP to go</span>
                </div>
                <div className="cta">
                  <button className="btn go" id="again" onClick={again}>
                    {result.again}
                    <kbd>Space</kbd>
                  </button>
                  <button className="btn alt" id="close" onClick={leave}>
                    Back<kbd>Esc</kbd>
                  </button>
                </div>
                <button className="lnk" id="shareB" onClick={openShare} disabled={sharing}>
                  Share this score
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="pad" id="pad">
          {pad !== 'a' && (
            <button aria-label="Left" {...padBtn('l')}>
              {ARROW(-1)}
            </button>
          )}
          {pad !== 'lr' && (
            <button className="act" {...padBtn('a')}>
              {g.act || 'Go'}
            </button>
          )}
          {pad !== 'a' && (
            <button aria-label="Right" {...padBtn('r')}>
              {ARROW(1)}
            </button>
          )}
        </div>
      </div>
      {share && result && (
        <div className="scrim on" id="share" role="dialog" aria-modal="true" aria-label="Share this score" onClick={(e) => e.target === e.currentTarget && setShare(null)}>
          <div className="sheet" style={{ position: 'relative' }}>
            <button className="x" aria-label="Close" onClick={() => setShare(null)}>
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img id="shImg" alt={share.img ? 'Score card' : 'Your browser blocked the image. The link still works.'} src={share.img ?? undefined} />
            <div className="row">
              <a className="btn go" id="shDl" href={share.img ?? '#'} download={`${BRAND.name.toLowerCase()}-${game}-${result.score}.png`}>
                Download
              </a>
              <button
                className="btn alt"
                id="shX"
                onClick={() =>
                  window.open(
                    'https://x.com/intent/post?text=' + encodeURIComponent(`I scored ${fmt(result.score)} in ${g.name} on ${BRAND.name}. Beat it:`) + '&url=' + encodeURIComponent(share.link),
                    '_blank',
                    'noopener',
                  )
                }
              >
                Post on X
              </button>
              <button className="btn alt" id="shCopy" onClick={() => copyLink(share.link)}>
                Copy challenge link
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

function titleFor(mode: RunMode, opp: string | null): string {
  if (mode === 'ranked') return 'Ranked run';
  if (mode === 'cup') return `${BRAND.name} Cup run`;
  if (mode === 'duel') return opp ? `Duel against ${opp}` : 'Duel run';
  if (mode === 'challenge') return opp ? `Challenge from ${opp}` : 'Challenge run';
  return 'Practice run';
}

/** Turns the server's answer into the prototype's result screen. Nothing here is computed from the local run. */
function buildResult(res: FinishRunResponse, best: number, targets: Targets): ResultView {
  const { mode, score: sc, place } = res;
  const cup = mode === 'cup';
  const B: { c: string; t: string }[] = [];
  const has = (b: FinishRunResponse['badges'][number]) => res.badges.includes(b);
  let info = "Practice runs aren't recorded. Play ranked to get on the board.";
  let rows = res.top5;
  let again = 'Play again';
  let shareLine = 'Practice run';
  let cheer = res.newBest;
  let opp: string | null = targets.duel?.opp ?? null;
  const xpBadge = () => res.xpGained > 0 && B.push({ c: 'b2', t: `+${res.xpGained} XP` });

  if (res.rewardsHeld || has('held')) {
    B.push({ c: '', t: 'Held for review' });
    info = 'This run is being reviewed. Nothing was recorded and its rewards wait for the review.';
    shareLine = MODE_TAG[mode] + ' run';
  } else if (mode === 'ranked' || cup) {
    const paid = cup ? CUP_WINNERS : WEEKLY_WINNERS;
    if (res.newBest) B.push({ c: 'b1', t: 'New best' });
    if (place) B.push({ c: '', t: `Place ${place}` });
    if (place && place <= paid) B.push({ c: 'b3', t: 'Prize zone' });
    xpBadge();
    if (res.boxDropped) B.push({ c: 'b3', t: 'Mystery box' });
    if (place && place <= paid) info = `Hold place ${place} until the ${cup ? 'cup' : 'week'} closes and you win ${fmt(res.prizeIfHeld)} tChips.`;
    else if (place) info = `Your best is ${fmt(Math.max(best, res.newBest ? sc : 0))}.`;
    else info = 'Score at least 1 to get on the board.';
    shareLine = place ? `Place ${place} this week` : 'Ranked run';
  } else if (mode === 'duel' && res.duel) {
    const d = res.duel;
    opp = d.opponent ?? opp;
    if (d.won === null) {
      B.push({ c: '', t: 'Waiting for an opponent' });
      info = `Waiting for an opponent. Your stake is refunded if nobody joins within ${ECONOMY.duelExpiryHours} hours.`;
      rows = [{ place: 1, name: 'You', score: sc, me: true }];
      shareLine = 'Duel run';
    } else {
      const t = d.opponentScore ?? 0, o = d.opponent ?? 'your opponent';
      if (d.won) {
        B.push({ c: 'b1', t: 'Duel won' }, { c: 'b3', t: `+${fmt(d.payout)} tChips` });
        info = `You beat ${o}'s ${fmt(t)} and took the pot.`;
      } else {
        B.push({ c: '', t: 'Duel lost' });
        info = `${o} scored ${fmt(t)}. You needed ${fmt(Math.max(1, t - sc + 1))} more.`;
      }
      cheer = d.won;
      shareLine = d.won ? 'Duel won' : 'Duel lost';
      if (!rows.length)
        rows = [
          { name: 'You', score: sc, me: true },
          { name: o, score: t, me: false },
        ]
          .sort((a, b) => b.score - a.score || Number(a.me) - Number(b.me))
          .map((r, i) => ({ place: i + 1, ...r }));
    }
    xpBadge();
    again = 'Rematch';
  } else if (mode === 'challenge' && res.challenge) {
    const c = res.challenge;
    opp = c.opponent || opp;
    B.push(c.won ? { c: 'b1', t: 'Challenge won' } : { c: '', t: 'Challenge lost' });
    info = c.won ? `You beat ${c.opponent}'s ${fmt(c.target)}. Send your score back to them.` : `${c.opponent} scored ${fmt(c.target)}. You needed ${fmt(Math.max(1, c.target - sc + 1))} more.`;
    xpBadge();
    cheer = c.won;
    again = 'Try again';
    shareLine = c.won ? 'Challenge won' : 'Challenge lost';
  } else {
    B.push({ c: '', t: 'Not recorded' });
    // Practice shows the board as it stood when the run started (display only).
    if (!rows.length) {
      const list = targets.rows.map((r) => ({ name: r.n, score: r.s, me: false }));
      if (targets.best > 0) list.push({ name: 'You', score: targets.best, me: true });
      rows = list.sort((a, b) => b.score - a.score).slice(0, 5).map((r, i) => ({ place: i + 1, ...r }));
    }
  }
  const lv = res.user.level, xp = res.user.xp;
  return {
    title: titleFor(mode, opp), score: sc, badges: B, info, rows, level: lv, xpPct: pct(xp, lv), xpToGo: Math.max(0, levelCeil(lv) - xp), again,
    runId: res.status === 'finished' ? res.runId : null, shareLine, cheer,
  };
}
