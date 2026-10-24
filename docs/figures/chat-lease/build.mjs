import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.agents/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../../.agents/skills/anatomy/scripts/inline-kit.mjs";
import { LEASE, RENEW, POLL, SPEED, createLease, describe } from "./lease.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 600;
const HEIGHT = 380;
const AZIMUTH = 38;

const PLATE = { x: -132, y: -50, w: 264, d: 104, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;

const PLINTH = { x: -33, y: -35, w: 66, d: 68, r: 3 };
const CASE = { x: -30, y: -32, w: 60, d: 62, r: 3 };
const CASE_Z = 3;
const CASE_TOP = 31;
const DIAL = [0, 10];
const DIAL_R = 17;
const DIAL_TOP = CASE_TOP + 6;
const PLUNGER = [0, -20];
const CAP_TOP = 48;
const PRESS = 3;
const KNOB = [20, -20];
const COUNTER = { x: -9, y: CASE.y + CASE.d, w: 18, d: 1.6, r: 0.6 };

const BLOCK_H = 22;
const PAD_R = 2.2;
const PAD_GAP = 0.5;
const STROKE = PRESS + PAD_GAP;
// The two workers mirror each other across x = 0; B's arm rides higher so the arms pass.
const WORKERS = [
  { who: "A", side: -1, armZ: 58 },
  { who: "B", side: 1, armZ: 68 },
].map((w) => ({
  ...w,
  block: { x: w.side < 0 ? -112 : 60, y: -38, w: 52, d: 44, r: 3 },
  post: [86 * w.side, -20],
  tap: [3.2 * w.side, -20],
  lamp: [102 * w.side, -28],
  slide: [100 * w.side, -2],
}));

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-86, -20, 74], [86, -20, 84], [0, -20, 76]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: AZIMUTH },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const C = (x, y, r, z, h, style, steps = 28, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
const depth = ([x, y], z = 0) => k.depthOf([x, y, z], P);
const byDepth = (points) => [...points].sort((a, b) => depth(a) - depth(b));
const screws = (points, z, ring = 1.8) => L(points.map(([x, y]) => k.ring(x, y, ring, z, P, 14)).join(""), { tone: "lo" }) + D(points.map(([x, y]) => at([x, y, z])), { size: 0.45 });

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(C(x, y, 7, -PLATE_H - FOOT_H, 1.6, { tone: "lo" }));
    out.push(C(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  out.push(screws(k.corners(PLATE, 10), 0, 2.2));
  const strip = { x: -62, y: PLATE.y + PLATE.d - 13, w: 176, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const label = { x: -120, y: 34, w: 46, d: 13, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: "faint" }));
  out.push(
    ...[[30, 37], [24, 40.5], [32, 44]].map(([w, y]) => L(k.lineOnTop([label.x + 5, y], [label.x + 5 + w, y], 0.8, P), { tone: "lo", free: "both" })),
  );
  out.push(D([at([label.x + label.w - 4, label.y + 3.5, 0.8]), at([label.x + label.w - 4, label.y + label.d - 3.5, 0.8])], { size: 0.45 }));
  return out.join("");
}

function block(w) {
  const { block: b, side } = w;
  const out = [`<path class="iso-halo" d="${k.haloOf(b, 0, BLOCK_H, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf(b, 0, BLOCK_H, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(b, 6, P, 6), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(b, 3), BLOCK_H, P, 6), { tone: "faint" }));
  out.push(screws(k.corners(b, 6), BLOCK_H, 1.4));
  const tag = { x: b.x + 8, y: b.y + b.d, w: 24, d: 0.8, r: 0.4 };
  out.push(S(k.slabOf(tag, 9, 8, P, 2), { tone: "lo", crease: "none" }));
  out.push(L([11.5, 14.5].map((z) => k.segment([tag.x + 3, tag.y + tag.d, z], [tag.x + (z < 13 ? 15 : 19), tag.y + tag.d, z], P)).join(""), { tone: "lo", free: "both" }));
  out.push(D([at([tag.x + tag.w - 2.4, tag.y + tag.d, 11]), at([tag.x + tag.w - 2.4, tag.y + tag.d, 15])], { size: 0.4 }));
  // Vents: closed slots between the post and the near edge.
  for (const y of [-8, -3.5, 1]) {
    out.push(L(k.planOutline({ x: side * 72 - 7, y, w: 14, d: 1.8, r: 0.9 }, BLOCK_H, P, 3), { tone: "lo" }));
  }
  // Power slide: a slot with a knob that rides it.
  const [sx, sy] = w.slide;
  out.push(S(k.slabOf({ x: sx - 7, y: sy - 3, w: 14, d: 6, r: 1.5 }, BLOCK_H, 0.6, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline({ x: sx - 5, y: sy - 1, w: 10, d: 2, r: 1 }, BLOCK_H + 0.6, P, 3), { tone: "faint" }));
  out.push(`<g data-part="slide-${w.who}" transform="${k.translateAlong(P, [3, 0, 0])}">${S(k.slabOf({ x: sx - 2, y: sy - 2, w: 4, d: 4, r: 1 }, BLOCK_H + 0.6, 2.6, P, 3, 0.3), { tone: "hi", crease: "lo" })}</g>`);
  // Lamp: a bezel and a lens; the dot is the worker's state.
  const [lx, ly] = w.lamp;
  out.push(C(lx, ly, 3.4, BLOCK_H, 1.2, { tone: "mid" }));
  out.push(C(lx, ly, 2.2, BLOCK_H + 1.2, 1, { tone: "hi", crease: "lo" }));
  out.push(`<g data-part="lamp-${w.who}">${D([at([lx, ly, BLOCK_H + 2.2])], { size: 1, tone: "hi", pulse: true })}</g>`);
  out.push(`<g data-part="idle-${w.who}" style="display:none">${D([at([lx, ly, BLOCK_H + 2.2])], { size: 0.8, tone: "mid" })}</g>`);
  return out.join("");
}

function column(w) {
  const [px, py] = w.post;
  const clampZ = w.armZ - 2;
  const top = clampZ + 14;
  const out = [];
  out.push(C(px, py, 5.2, BLOCK_H, 3, { tone: "mid" }));
  out.push(C(px, py, 3.2, BLOCK_H + 3, clampZ - BLOCK_H - 3, { tone: "mid", crease: "none" }));
  out.push(L([BLOCK_H + 14, BLOCK_H + 26].map((z) => k.sideArc(px, py, 3.2, z, P, 16)).join(""), { tone: "faint" }));
  const clamp = { x: px - 7, y: py - 7, w: 14, d: 14, r: 2.5 };
  out.push(S(k.slabOf(clamp, clampZ, 10, P, 4, 0.6), { tone: "mid" }));
  out.push(D([at([px - w.side * 4.5, py - 4.5, clampZ + 10]), at([px - w.side * 4.5, py + 4.5, clampZ + 10])], { size: 0.45 }));
  out.push(C(px, py, 3.2, clampZ + 10, top - clampZ - 12, { tone: "mid", crease: "none" }));
  out.push(C(px, py, 3.8, top - 2, 2, { tone: "mid" }, 28, 0.4));
  // Thumb screw on the clamp's near face.
  const ty = clamp.y + clamp.d;
  out.push(S(k.slabOf({ x: px - 1.4, y: ty, w: 2.8, d: 3, r: 0.8 }, clampZ + 3, 4, P, 2), { tone: "mid", crease: "none" }));
  out.push(C(px, ty + 4.4, 2.6, clampZ + 2, 6, { tone: "mid" }, 20));
  out.push(L(k.knurl(px, ty + 4.4, 2.6, clampZ + 2, clampZ + 8, 18, P), { tone: "lo" }));
  return out.join("");
}

function arm(w) {
  const [px, py] = w.post;
  const from = px - w.side * 7;
  const to = w.tap[0] + w.side * 2.5;
  const plan = { x: Math.min(from, to), y: py - 3, w: Math.abs(to - from), d: 6, r: 1.5 };
  const out = [S(k.slabOf(plan, w.armZ, 6, P, 3, 0.5), { tone: "mid" })];
  // Guide bushing over the tapper, and two rivets where the arm meets the clamp.
  out.push(C(w.tap[0], w.tap[1], 2.4, w.armZ + 6, 1.6, { tone: "mid" }, 20));
  out.push(D([at([from - w.side * 4, py - 1.6, w.armZ + 6]), at([from - w.side * 4, py + 1.6, w.armZ + 6])], { size: 0.4 }));
  return out.join("");
}

function tapper(w) {
  const [x, y] = w.tap;
  const padZ = CAP_TOP + PAD_GAP;
  const body = [
    C(x, y, 1, padZ + 1.5, w.armZ + 4.5 - padZ - 1.5, { tone: "hi", crease: "none" }, 16),
    C(x, y, 1.6, padZ + 1.5, 1.4, { tone: "hi", crease: "lo" }, 18),
    C(x, y, PAD_R, padZ, 1.5, { tone: "hi", crease: "lo" }, 20, 0.3),
  ].join("");
  return `<g data-part="tap-${w.who}">${body}</g>`;
}

function clock() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLINTH, 0, CASE_TOP, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf(PLINTH, 0, CASE_Z, P, 4, 0.6), { tone: "lo" }));
  out.push(S(k.slabOf(CASE, CASE_Z, CASE_TOP - CASE_Z, P, 4, 1), { tone: "mid", inner: L(k.sideSeam(CASE, 25, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(CASE, 3), CASE_TOP, P, 4), { tone: "faint" }));
  out.push(screws(k.corners(CASE, 6.5), CASE_TOP, 1.5));
  // Lease counter: a window on the front face with two number wheels.
  out.push(S(k.slabOf(COUNTER, 9, 12, P, 3, 0.3), { tone: "lo", crease: "none" }));
  const face = k.sideMatrix([0, COUNTER.y + COUNTER.d], 12.6, P, "left");
  out.push(`<g data-part="counter">${k.faceTextSvg(face, "07", { size: 6.5, tone: "hi", anchor: "middle" })}</g>`);
  // Lease length knob, set at three minutes.
  const [kx, ky] = KNOB;
  out.push(C(kx, ky, 4.6, CASE_TOP, 4, { tone: "mid" }, 32));
  out.push(L(k.knurl(kx, ky, 4.6, CASE_TOP, CASE_TOP + 4, 32, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([kx, ky], [kx, ky + 4], CASE_TOP + 4, P), { tone: "hi" }));
  out.push(D([at([kx, ky, CASE_TOP + 4])], { size: 0.5, tone: "hi" }));
  // Dial: one turn is the whole lease, a tick every renewal, a major tick every 30 s.
  const [x, y] = DIAL;
  out.push(C(x, y, DIAL_R, CASE_TOP, DIAL_TOP - CASE_TOP, { tone: "hi", crease: "lo" }, 64, 0.8));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3, DIAL_TOP, 84, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 2, LEASE / RENEW, 6, DIAL_TOP, [1.2, 2.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([x, y - DIAL_R + 2], [x, y - DIAL_R + 5.6], DIAL_TOP, P), { tone: "hi" }));
  out.push(L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([x, y + 8], DIAL_TOP, P, "x"), "3 min", { size: 2.2, tone: "lo", anchor: "middle" }));
  // Reset plunger: a gland, a fixed stem and a cap that slides down over it.
  const [px, py] = PLUNGER;
  out.push(C(px, py, 4.4, CASE_TOP, 3, { tone: "mid" }, 28, 0.4));
  out.push(L(k.ring(px, py, 2.4, CASE_TOP + 3, P, 18), { tone: "faint" }));
  out.push(C(px, py, 1.6, CASE_TOP + 3, CAP_TOP - 4 - CASE_TOP - 3, { tone: "mid", crease: "none" }, 16));
  const cap = [
    C(px, py, 2.8, CAP_TOP - 7, 4, { tone: "hi", crease: "none" }, 20),
    C(px, py, 6.5, CAP_TOP - 3, 3, { tone: "hi", crease: "lo" }, 40, 0.6),
    L(k.ring(px, py, 4.6, CAP_TOP, P, 32), { tone: "faint" }),
  ].join("");
  out.push(`<g data-part="cap">${cap}</g>`);
  return out.join("");
}

const needleAt = (share) => {
  const angle = share * Math.PI * 2;
  const [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(angle) * 3.2, y + Math.cos(angle) * 3.2], [x + Math.sin(angle) * (DIAL_R - 2), y - Math.cos(angle) * (DIAL_R - 2)], DIAL_TOP + 0.2, P);
};

const near = [...WORKERS].sort((a, b) => depth(a.post) - depth(b.post));
const taps = [...WORKERS].sort((a, b) => depth(a.tap) - depth(b.tap));
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A lease clock on a bench between two worker machines. The clock's dial runs down from three minutes; each worker has an arm over the clock's reset plunger. The worker holding the lease taps the plunger every five seconds, which sends the needle back to three minutes. A counter on the clock's front shows the lease number.",
  body: [
    plate(),
    ...near.map(block),
    clock(),
    `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(1)}" style="stroke-width:1.1"/>`,
    ...taps.map(tapper),
    ...near.map((w) => column(w) + arm(w)),
  ],
});

const model = readFileSync(join(HERE, "lease.mjs"), "utf8").replace(/^export /gm, "");
const live = `
${model}
const P = ${JSON.stringify(P)};
const DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP};
const PRESS = ${PRESS}, STROKE = ${STROKE}, PAD_GAP = ${PAD_GAP};
const needleAt = ${needleAt.toString().replace("k.lineOnTop", "lineOnTop")};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const needle = part("needle"), cap = part("cap"), counter = part("counter").querySelector("text");
const parts = Object.fromEntries(["A", "B"].map((w) => [w, { tap: part("tap-" + w), slide: part("slide-" + w), lamp: part("lamp-" + w), idle: part("idle-" + w) }]));
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const state = createLease();
const tapAge = { A: 9, B: 9 };
const slideAt = { A: 3, B: 3 };
let shown = left(state) / LEASE;
let frame = 0, last = 0, visible = false, touring = !still.matches, idleTimer = 0, tourClock = 0;
// A tap: down in 80 ms, held 40 ms, back up in 200 ms.
const dropOf = (age) => age < 0.08 ? Math.sin((age / 0.08) * Math.PI / 2) : age < 0.12 ? 1 : age < 0.32 ? 0.5 + 0.5 * Math.cos(((age - 0.12) / 0.2) * Math.PI) : 0;
function draw() {
  needle.setAttribute("d", needleAt(shown));
  let press = 0;
  for (const w of ["A", "B"]) {
    const drop = STROKE * dropOf(tapAge[w]);
    press = Math.max(press, drop - PAD_GAP);
    parts[w].tap.setAttribute("transform", translateAlong(P, [0, 0, -drop]));
    parts[w].slide.setAttribute("transform", translateAlong(P, [slideAt[w], 0, 0]));
    const holding = state.renewing && state.holder === w;
    parts[w].lamp.style.display = state.up[w] && holding ? "" : "none";
    parts[w].idle.style.display = state.up[w] && !holding ? "" : "none";
  }
  cap.setAttribute("transform", translateAlong(P, [0, 0, -Math.min(PRESS, Math.max(0, press))]));
  const number = String(state.lease).padStart(2, "0");
  if (counter.textContent !== number) counter.textContent = number;
  const text = describe(state);
  if (readout.textContent !== text) readout.textContent = text;
}
const toggle = (w) => setUp(state, w, !state.up[w]);
function tour(dt) {
  tourClock += dt;
  const down = ["A", "B"].find((w) => !state.up[w]);
  if (down && state.renewing && state.holder !== down && tourClock > 2.5) { toggle(down); tourClock = 0; }
  else if (!down && state.renewing && tourClock > 5) { toggle(state.holder); tourClock = 0; }
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) tour(dt);
  for (const event of advance(state, dt * SPEED)) {
    if (event.kind !== "poll" && !calm) tapAge[event.who] = 0;
    if (event.kind === "claim") tourClock = 0;
  }
  for (const w of ["A", "B"]) {
    tapAge[w] += dt;
    const want = state.up[w] ? 3 : -3;
    slideAt[w] = calm ? want : slideAt[w] + (want - slideAt[w]) * (1 - Math.exp(-dt / 0.08));
  }
  const want = left(state) / LEASE;
  shown = calm || want < shown ? want : shown + (want - shown) * (1 - Math.exp(-dt / 0.05));
  draw();
  const settled = calm && !state.renewing && left(state) === 0 && !state.up.A && !state.up.B;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (w) => {
  toggle(w);
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; tourClock = 0; }, 9000);
  run();
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); else { cancelAnimationFrame(frame); frame = 0; } }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", (event) => {
  const box = svg.getBoundingClientRect();
  steer(event.clientX - box.left < box.width / 2 ? "A" : "B");
});
stage.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const w = key === "a" || event.key === "ArrowLeft" ? "A" : key === "b" || event.key === "ArrowRight" ? "B" : null;
  if (!w) return;
  event.preventDefault();
  steer(w);
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Chat run lease",
  hint: "Click a worker to stop or start it",
  readout: describe(createLease()),
  keys: [
    { mark: "lit", label: "Needle: time left on the lease, one turn is 3 min" },
    { mark: "raised", label: "Tappers and reset plunger: one renewal every 5 s" },
    { mark: "flat", label: "Counter: a new lease number on every claim" },
  ],
  caption: `How a Timely chat run survives a crashed worker (apps/api/internal/features/chat/runner.go), running ${SPEED}× fast. A worker claims a run with a ${LEASE / 60}-minute lease and renews it every ${RENEW} s while it works, so the needle never falls more than one tick. Stop that worker and the lease runs down; once it has run out, the other worker's next poll (one every ${POLL} s) claims the run under a new lease number and resumes it from its last checkpoint. A restarted worker never renews its old lease: it only polls, like any idle worker.`,
  body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Chat run lease. Press A or B, or click the left or right half, to stop or start that worker.">${svg}</div>`,
});

const name = theme === "light" ? "chat-lease-light.html" : "chat-lease.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Chat run lease", theme, body, script: kitScript() + live }));
console.log("wrote", name);
