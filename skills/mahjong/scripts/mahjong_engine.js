#!/usr/bin/env node
// mahjong_engine.js — Taiwan 16-tile mahjong CLI engine
// Ported from .mahjong_engine.py

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  SEATS, WIND_TILES, ALL_PLAYABLE_TILES, DEFAULT_RULESET,
  sortedTiles, compareTiles, isStandardWin, findStandardDecompositions,
  isSuited, isHonor, nextSeat, seatWind, scoreState, counterFrom,
} from "./mahjong_scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "..", ".mahjong_state.json");
const DEFAULT_LOG_DIR = join(__dirname, "..", "logs");

const SEAT_NAMES = { east: "東家", south: "南家", west: "西家", north: "北家" };
const HONOR_NAMES = { E: "東", S: "南", W: "西", N: "北", C: "中", F: "發", P: "白" };
const FLOWER_NAMES = {
  H1: "春", H2: "夏", H3: "秋", H4: "冬",
  H5: "梅", H6: "蘭", H7: "竹", H8: "菊",
};
const SUIT_ORDER = { m: 0, p: 1, s: 2 };
const HONOR_ORDER = { E: 0, S: 1, W: 2, N: 3, C: 4, F: 5, P: 6 };
const SUIT_CODES = ["m", "p", "s"];
const DRAW_RESERVE = 16;

// ─── State I/O ───

function loadState() {
  const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  ensureStateDefaults(state);
  return state;
}

function saveState(state) {
  ensureStateDefaults(state);
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function ensureStateDefaults(state) {
  const defaults = {
    variant: "taiwan-16", ruleset: DEFAULT_RULESET, round_wind: "east",
    dealer_streak: 0, score_context: {}, declared_ting: {}, ready_bonus: {},
    seat_turns: {}, opening_claim_free: true, flower_special_candidate: null,
    log_dir: DEFAULT_LOG_DIR,
  };
  for (const [key, val] of Object.entries(defaults)) {
    if (state[key] == null) state[key] = val;
  }
  for (const bucket of ["hands", "flowers", "melds", "discards"]) {
    if (!state[bucket]) state[bucket] = {};
    for (const seat of SEATS) {
      if (!state[bucket][seat]) state[bucket][seat] = [];
    }
  }
  for (const seat of SEATS) {
    if (state.declared_ting[seat] == null) state.declared_ting[seat] = false;
    if (state.ready_bonus[seat] == null) state.ready_bonus[seat] = null;
    if (state.seat_turns[seat] == null) state.seat_turns[seat] = 0;
  }
}

// ─── Wall ───

function createFullWall() {
  const wall = [];
  for (const suit of SUIT_CODES) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 0; c < 4; c++) wall.push(`${n}${suit}`);
    }
  }
  for (const honor of Object.keys(HONOR_NAMES)) {
    for (let c = 0; c < 4; c++) wall.push(honor);
  }
  for (const flower of Object.keys(FLOWER_NAMES)) {
    wall.push(flower);
  }
  return wall;
}

function shuffleWall(seed) {
  const wall = createFullWall();
  // Seeded PRNG (simple mulberry32)
  let s = seed != null ? seed >>> 0 : (Math.random() * 0xFFFFFFFF) >>> 0;
  function rng() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// ─── Tile helpers ───

function tileName(tile) {
  if (tile.endsWith("m")) return `${tile.slice(0, -1)}萬`;
  if (tile.endsWith("p")) return `${tile.slice(0, -1)}筒`;
  if (tile.endsWith("s")) return `${tile.slice(0, -1)}條`;
  if (HONOR_NAMES[tile]) return HONOR_NAMES[tile];
  return FLOWER_NAMES[tile] || tile;
}

function parseTile(raw) {
  const value = raw.trim().replace(/\s/g, "");
  if (!value) throw new Error("empty tile");
  const honorLookup = Object.fromEntries(Object.entries(HONOR_NAMES).map(([k, v]) => [v, k]));
  const flowerLookup = Object.fromEntries(Object.entries(FLOWER_NAMES).map(([k, v]) => [v, k]));
  if (honorLookup[value]) return honorLookup[value];
  if (flowerLookup[value]) return flowerLookup[value];
  if (value.length >= 2) {
    const suffix = value.at(-1);
    const number = value.slice(0, -1);
    if (suffix === "萬") return `${number}m`;
    if (suffix === "筒") return `${number}p`;
    if (suffix === "條" || suffix === "索") return `${number}s`;
  }
  // Try direct code
  if (ALL_PLAYABLE_TILES.includes(value)) return value;
  throw new Error(`無法辨識牌名: ${raw}`);
}

function sortKey(tile) {
  if (tile.endsWith("m") || tile.endsWith("p") || tile.endsWith("s")) {
    return [0, SUIT_ORDER[tile.at(-1)], parseInt(tile.slice(0, -1))];
  }
  if (HONOR_ORDER[tile] != null) return [1, HONOR_ORDER[tile], 0];
  return [2, parseInt(tile.slice(1)), 0];
}

function isFlower(tile) { return tile.startsWith("H"); }
function canChowWith(tile) { return tile.endsWith("m") || tile.endsWith("p") || tile.endsWith("s"); }

function wallRemaining(state) {
  if (state.front_index == null || state.back_index == null) return null;
  return Math.max(state.back_index - state.front_index + 1, 0);
}

function nowISO() { return new Date().toISOString(); }

// ─── Chow ───

function chowOptions(hand, tile) {
  if (!canChowWith(tile)) return [];
  const n = parseInt(tile.slice(0, -1));
  const suit = tile.at(-1);
  const counts = counterFrom(hand);
  const combos = [];
  const candidates = [[n - 2, n - 1], [n - 1, n + 1], [n + 1, n + 2]];
  for (const [a, b] of candidates) {
    if (a < 1 || b > 9) continue;
    const first = `${a}${suit}`;
    const second = `${b}${suit}`;
    if ((counts[first] || 0) > 0 && (counts[second] || 0) > 0) {
      const combo = sortedTiles([first, tile, second]);
      if (!combos.some(c => c.join(",") === combo.join(","))) {
        combos.push(combo);
      }
    }
  }
  return combos;
}

// ─── Structure score (AI discard heuristic) ───

function structureScore(tiles) {
  const counts = counterFrom(tiles);
  let score = 0;
  for (const [tile, count] of Object.entries(counts)) {
    if (count >= 3) score += 10;
    else if (count === 2) score += 4;
    else score += 1;

    if (isSuited(tile)) {
      const number = parseInt(tile.slice(0, -1));
      const suit = tile.at(-1);
      for (const [offset, weight] of [[1, 1.6], [2, 0.7]]) {
        for (const direction of [-1, 1]) {
          const neighbor = number + offset * direction;
          if (neighbor >= 1 && neighbor <= 9 && (counts[`${neighbor}${suit}`] || 0) > 0) {
            score += weight;
          }
        }
      }
    } else if (count === 1) {
      score -= 1.5;
    }
  }
  return score;
}

function chooseDiscard(hand, meldCount) {
  const unique = [...new Set(hand)].sort(compareTiles);
  const candidates = [];
  for (const tile of unique) {
    const remaining = [...hand];
    remaining.splice(remaining.indexOf(tile), 1);
    const winBonus = isStandardWin(remaining, meldCount) ? 500 : 0;
    let score = structureScore(remaining) + winBonus;
    if (HONOR_NAMES[tile] && hand.filter(t => t === tile).length === 1) score += 1.2;
    if (isSuited(tile)) {
      const number = parseInt(tile.slice(0, -1));
      if ((number === 1 || number === 9) && hand.filter(t => t === tile).length === 1) score += 0.8;
    }
    candidates.push([score, tile]);
  }
  candidates.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return compareTiles(a[1], b[1]);
  });
  return candidates[0][1];
}

// ─── Ready / ting ───

function readyTilesForHand(hand, meldCount) {
  const winners = [];
  for (const tile of ALL_PLAYABLE_TILES) {
    if (isStandardWin(sortedTiles([...hand, tile]), meldCount)) {
      winners.push(tile);
    }
  }
  return winners;
}

function canDeclareTing(hand, meldCount, discardTile) {
  const remaining = [...hand];
  const idx = remaining.indexOf(discardTile);
  if (idx === -1) return false;
  remaining.splice(idx, 1);
  return readyTilesForHand(remaining, meldCount).length > 0;
}

function markDeclaredTing(state, seat) {
  state.declared_ting[seat] = true;
  if (state.opening_claim_free && state.seat_turns[seat] === 0) {
    state.ready_bonus[seat] = seat === state.dealer ? "heaven_ready" : "earth_ready";
  }
}

// ─── Discard registration ───

function firstTurnDiscard(state, seat) {
  return state.opening_claim_free && state.seat_turns[seat] === 0;
}

function registerDiscard(state, seat, tile) {
  const isFirst = firstTurnDiscard(state, seat);
  state.seat_turns[seat] += 1;
  state.discards[seat].push(tile);
  state.last_discard = { tile, by: seat, first_turn_discard: isFirst };
  if (seat === "east") delete state.last_draw;
}

function markOpeningBroken(state) { state.opening_claim_free = false; }

// ─── Win context helpers ───

function humanWinAvailable(state, winnerSeat, discarder) {
  return (
    winnerSeat !== state.dealer &&
    state.opening_claim_free &&
    discarder === state.dealer &&
    state.last_discard?.first_turn_discard
  );
}

function earthWinAvailable(state, seat) {
  return seat !== state.dealer && state.opening_claim_free && state.seat_turns[seat] === 0;
}

function userCanSelfDrawHu(state) {
  return (
    state.turn === "east" &&
    state.phase === "discard" &&
    isStandardWin(state.hands.east, state.melds.east.length)
  );
}

// ─── Flower specials ───

function specialFlowerOutcome(state, revealingSeat) {
  const flowerCounts = {};
  let total = 0;
  for (const seat of SEATS) {
    flowerCounts[seat] = state.flowers[seat].length;
    total += state.flowers[seat].length;
  }
  if (total < 8) return null;
  if (flowerCounts[revealingSeat] === 8) {
    return { seat: revealingSeat, kind: "eight_flowers" };
  }
  const sevenHolder = SEATS.find(s => flowerCounts[s] === 7);
  const oneHolder = SEATS.find(s => flowerCounts[s] === 1);
  if (sevenHolder && oneHolder) {
    return { seat: sevenHolder, kind: "seven_rob_one", from: oneHolder };
  }
  return null;
}

function applyFlowerSpecialIfNeeded(state, revealingSeat, log) {
  const outcome = specialFlowerOutcome(state, revealingSeat);
  if (!outcome) return false;
  if (outcome.seat === revealingSeat) {
    state.flower_special_candidate = { seat: revealingSeat, [outcome.kind]: true };
    return false;
  }
  markWinner(state, outcome.seat, "ron", { from_seat: outcome.from, seven_rob_one: true });
  if (log) log.push(`${SEAT_NAMES[outcome.seat]}七搶一。`);
  return true;
}

function flowerSpecialContext(state, seat) {
  const candidate = state.flower_special_candidate;
  if (candidate && candidate.seat === seat) {
    const ctx = { ...candidate };
    delete ctx.seat;
    return ctx;
  }
  return {};
}

function clearFlowerSpecialCandidate(state, seat) {
  if (state.flower_special_candidate?.seat === seat) {
    state.flower_special_candidate = null;
  }
}

function maybeForceFlowerWin(state, seat, tile, log) {
  const context = flowerSpecialContext(state, seat);
  if (!Object.keys(context).length) return false;
  markWinner(state, seat, "tsumo", { tile, ...context });
  clearFlowerSpecialCandidate(state, seat);
  if (log) {
    if (context.eight_flowers) log.push(`${SEAT_NAMES[seat]}八仙過海。`);
    if (context.seven_rob_one) log.push(`${SEAT_NAMES[seat]}七搶一。`);
  }
  return true;
}

// ─── Drawing ───

function drawTile(state, seat, fromBack = false) {
  const wall = state.wall;
  if (state.front_index > state.back_index) throw new Error("牌山已空");
  let tile;
  if (fromBack) {
    tile = wall[state.back_index];
    state.back_index -= 1;
  } else {
    tile = wall[state.front_index];
    state.front_index += 1;
  }
  const flowers = [];
  while (isFlower(tile)) {
    state.flowers[seat].push(tile);
    state.flowers[seat] = sortedTiles(state.flowers[seat]);
    flowers.push(tile);
    if (state.front_index > state.back_index) throw new Error("補花後牌山已空");
    tile = wall[state.back_index];
    state.back_index -= 1;
  }
  return { tile, flowers };
}

function recordLastDraw(state, seat, tile, flowers, source) {
  if (seat !== "east") return;
  state.last_draw = { tile, flowers: [...flowers], source };
}

// ─── Winner ───

function markWinner(state, seat, winType, extra = {}) {
  const winner = { seat, type: winType };
  if (extra.tile != null) winner.tile = extra.tile;
  if (extra.from_seat != null) winner.from = extra.from_seat;
  state.winner = winner;
  state.turn = seat;
  state.phase = "ended";
  const scoreContext = { ...(state.score_context || {}) };
  for (const [k, v] of Object.entries(extra)) {
    if (k !== "tile" && k !== "from_seat" && v) scoreContext[k] = v;
  }
  state.score_context = scoreContext;
  handleHandEnd(state);
}

// ─── Logging ───

function logRoot(state) {
  return state.log_dir || process.env.MAHJONG_LOG_DIR || DEFAULT_LOG_DIR;
}

function appendJsonl(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf-8");
}

function scoreSummary(state) {
  if (!state.winner) return null;
  try {
    return scoreState(state, state.ruleset || DEFAULT_RULESET);
  } catch (e) {
    return { error: e.message, ruleset: state.ruleset || DEFAULT_RULESET };
  }
}

function handSummary(state) {
  return {
    match_id: state.match_id,
    hand_index: state.hand_index,
    round_wind: state.round_wind,
    dealer: state.dealer,
    dealer_streak: state.dealer_streak || 0,
    result: state.winner ? state.winner.type : "draw",
    winner: state.winner,
    score: scoreSummary(state),
  };
}

function appendHandSummary(state) {
  const summary = handSummary(state);
  state.last_hand_summary = summary;
  const root = logRoot(state);
  appendJsonl(join(root, "hand_summaries.jsonl"), { timestamp: nowISO(), ...summary });
}

function handleHandEnd(state) { appendHandSummary(state); }

function writeLogs(state, commandName, result) {
  const event = {
    timestamp: nowISO(),
    command: commandName,
    status: result.status,
    log: result.log || [],
    public_view: publicView(state),
  };
  const root = logRoot(state);
  appendJsonl(join(root, "events.jsonl"), event);
  if (result.status === "ended") {
    appendJsonl(join(root, "hands.jsonl"), {
      timestamp: nowISO(),
      winner: state.winner,
      round_wind: state.round_wind || "east",
      dealer: state.dealer || "east",
      dealer_streak: state.dealer_streak || 0,
      score: scoreSummary(state),
    });
  }
  const latestPath = join(root, "latest_public.json");
  mkdirSync(dirname(latestPath), { recursive: true });
  writeFileSync(latestPath, JSON.stringify(publicView(state), null, 2), "utf-8");
}

// ─── Public view ───

function visibleMelds(state) {
  const result = {};
  for (const seat of SEATS) {
    result[seat] = state.melds[seat].map(m => ({
      type: m.type,
      tiles: m.tiles.map(tileName),
      from: m.from || null,
    }));
  }
  return result;
}

function visibleFlowers(state) {
  const result = {};
  for (const seat of SEATS) {
    result[seat] = sortedTiles(state.flowers[seat]).map(tileName);
  }
  return result;
}

function visibleDiscards(state) {
  const result = {};
  for (const seat of SEATS) {
    result[seat] = state.discards[seat].map(tileName);
  }
  return result;
}

function availableActions(state) {
  if (state.winner) {
    return state.match_complete ? [] : [{ type: "next_hand" }];
  }
  if (state.phase === "ended") {
    return state.match_complete ? [] : [{ type: "next_hand" }];
  }
  if (state.phase === "response" && state.pending_user_action) {
    const actions = [];
    let chowIndex = 1;
    for (const option of state.pending_user_action.options) {
      if (option.type === "chow") {
        actions.push({ type: "chow", index: chowIndex, tiles: option.tiles.map(tileName) });
        chowIndex++;
      } else {
        actions.push({ type: option.type });
      }
    }
    actions.push({ type: "pass" });
    return actions;
  }
  if (state.turn === "east" && state.phase === "discard") {
    const actions = [{ type: "discard" }];
    if (!state.declared_ting.east) {
      const tingTiles = [...new Set(state.hands.east)].sort(compareTiles)
        .filter(t => canDeclareTing(state.hands.east, state.melds.east.length, t))
        .map(tileName);
      if (tingTiles.length) actions.push({ type: "ting", tiles: tingTiles });
    }
    if (userCanSelfDrawHu(state)) actions.push({ type: "hu" });
    return actions;
  }
  return [];
}

function publicView(state) {
  ensureStateDefaults(state);
  const view = {
    variant: state.variant,
    ruleset: state.ruleset || DEFAULT_RULESET,
    match_id: state.match_id,
    hand_index: state.hand_index,
    match_complete: state.match_complete || false,
    round_wind: state.round_wind || "east",
    dealer: state.dealer || "east",
    dealer_streak: state.dealer_streak || 0,
    turn: state.turn,
    phase: state.phase,
    wall_remaining: wallRemaining(state),
    declared_ting: state.declared_ting || {},
    your_hand: sortedTiles(state.hands.east).map(tileName),
    your_flowers: sortedTiles(state.flowers.east).map(tileName),
    your_melds: visibleMelds(state).east,
    your_discards: state.discards.east.map(tileName),
    visible_flowers: visibleFlowers(state),
    visible_melds: visibleMelds(state),
    visible_discards: visibleDiscards(state),
    available_actions: availableActions(state),
  };
  if (state.last_hand_summary) view.last_hand_summary = state.last_hand_summary;
  if (state.last_draw) {
    view.last_draw = {
      tile: tileName(state.last_draw.tile),
      source: state.last_draw.source || "wall",
      flowers: (state.last_draw.flowers || []).map(tileName),
    };
  }
  if (state.last_discard) {
    view.last_discard = {
      by: state.last_discard.by,
      tile: tileName(state.last_discard.tile),
    };
  }
  if (state.pending_user_action) {
    const pending = state.pending_user_action;
    let chowIndex = 1;
    const options = [];
    for (const option of pending.options) {
      const entry = { type: option.type };
      if (option.type === "chow") {
        entry.index = chowIndex;
        entry.tiles = option.tiles.map(tileName);
        chowIndex++;
      }
      options.push(entry);
    }
    view.pending = { from: pending.from, tile: tileName(pending.tile), options };
  }
  if (state.winner) {
    const winner = { ...state.winner };
    if (winner.tile) winner.tile_name = tileName(winner.tile);
    view.winner = winner;
    view.score = scoreSummary(state);
  }
  return view;
}

// ─── Claims ───

function buildUserClaims(state, discarder, tile) {
  if (discarder === "east") return [];
  const hand = state.hands.east;
  const meldCount = state.melds.east.length;
  const claims = [];
  if (isStandardWin(sortedTiles([...hand, tile]), meldCount)) {
    claims.push({ type: "hu" });
  }
  if (state.declared_ting.east) return claims;
  if (hand.filter(t => t === tile).length >= 2) claims.push({ type: "pong" });
  if (hand.filter(t => t === tile).length >= 3) claims.push({ type: "kong" });
  if (discarder === "north") {
    for (const combo of chowOptions(hand, tile)) {
      claims.push({ type: "chow", tiles: combo });
    }
  }
  return claims;
}

function otherClaims(state, discarder, tile) {
  const claims = [];
  const claimOrder = { hu: 0, kong: 1, pong: 2, chow: 3 };
  for (const seat of SEATS) {
    if (seat === discarder) continue;
    const hand = state.hands[seat];
    const meldCount = state.melds[seat].length;
    if (isStandardWin(sortedTiles([...hand, tile]), meldCount)) {
      claims.push({ seat, type: "hu", priority: 3 });
    } else if (state.declared_ting[seat]) {
      continue;
    } else {
      const count = hand.filter(t => t === tile).length;
      if (count >= 3) claims.push({ seat, type: "kong", priority: 2 });
      if (count >= 2) claims.push({ seat, type: "pong", priority: 2 });
      if (seat === nextSeat(discarder)) {
        const chowSets = chowOptions(hand, tile);
        if (chowSets.length) {
          claims.push({ seat, type: "chow", priority: 1, options: chowSets });
        }
      }
    }
  }
  claims.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const da = seatDistance(discarder, a.seat);
    const db = seatDistance(discarder, b.seat);
    if (da !== db) return da - db;
    return claimOrder[a.type] - claimOrder[b.type];
  });
  return claims;
}

function seatDistance(from, to) {
  return (SEATS.indexOf(to) - SEATS.indexOf(from) + 4) % 4;
}

function compareUserClaim(userClaims, aiClaims, discarder) {
  if (!userClaims.length) return false;
  const priorities = { hu: 3, kong: 2, pong: 2, chow: 1 };
  const bestUser = Math.max(...userClaims.map(c => priorities[c.type]));
  if (!aiClaims.length) return true;
  const bestAi = aiClaims[0].priority;
  if (bestUser > bestAi) return true;
  if (bestUser < bestAi) return false;
  return seatDistance(discarder, "east") <= seatDistance(discarder, aiClaims[0].seat);
}

function chooseBestChowOption(hand, options, meldCount) {
  const scored = options.map(option => {
    const remaining = [...hand];
    for (const tile of option) {
      if (tile !== option[1]) {
        const idx = remaining.indexOf(tile);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }
    return [structureScore(remaining) - meldCount * 0.1, option];
  });
  scored.sort((a, b) => a[0] - b[0]);
  return scored[0][1];
}

// ─── AI claim ───

function performAiClaim(state, claim, discarder, tile, log) {
  const seat = claim.seat;
  const hand = state.hands[seat];

  if (claim.type === "hu") {
    const specialContext = {};
    if (humanWinAvailable(state, seat, discarder)) specialContext.human_win = true;
    markWinner(state, seat, "ron", { tile, from_seat: discarder, ...specialContext });
    log.push(`${SEAT_NAMES[seat]}吃胡 ${SEAT_NAMES[discarder]} 的 ${tileName(tile)}。`);
    return;
  }

  if (claim.type === "pong") {
    markOpeningBroken(state);
    hand.splice(hand.indexOf(tile), 1);
    hand.splice(hand.indexOf(tile), 1);
    state.melds[seat].push({ type: "pong", tiles: [tile, tile, tile], from: discarder });
    log.push(`${SEAT_NAMES[seat]}碰 ${tileName(tile)}。`);
  } else if (claim.type === "kong") {
    markOpeningBroken(state);
    for (let i = 0; i < 3; i++) hand.splice(hand.indexOf(tile), 1);
    state.melds[seat].push({ type: "kong", tiles: [tile, tile, tile, tile], from: discarder });
    const { tile: supplement, flowers } = drawTile(state, seat, true);
    if (applyFlowerSpecialIfNeeded(state, seat, log)) return;
    hand.push(supplement);
    state.hands[seat] = sortedTiles(hand);
    log.push(`${SEAT_NAMES[seat]}明槓 ${tileName(tile)}，補進 ${tileName(supplement)}。`);
    if (flowers.length) log.push(`${SEAT_NAMES[seat]}補花 ${flowers.map(tileName).join(" ")}。`);
    if (Object.keys(flowerSpecialContext(state, seat)).length) {
      maybeForceFlowerWin(state, seat, supplement, log);
      return;
    }
    if (isStandardWin(state.hands[seat], state.melds[seat].length)) {
      markWinner(state, seat, "tsumo", { tile: supplement, kong_draw: true });
      log.push(`${SEAT_NAMES[seat]}自摸 ${tileName(supplement)}。`);
      return;
    }
  } else if (claim.type === "chow") {
    markOpeningBroken(state);
    const bestOption = chooseBestChowOption(hand, claim.options, state.melds[seat].length);
    for (const usedTile of bestOption) {
      if (usedTile !== tile) {
        hand.splice(hand.indexOf(usedTile), 1);
      }
    }
    state.melds[seat].push({ type: "chow", tiles: bestOption, from: discarder });
    log.push(`${SEAT_NAMES[seat]}吃 ${bestOption.map(tileName).join(" ")}。`);
  }

  state.hands[seat] = sortedTiles(hand);
  let discard;
  if (state.declared_ting[seat]) {
    discard = state.last_draw?.tile || hand[hand.length - 1];
    if (!hand.includes(discard)) discard = hand[hand.length - 1];
  } else {
    discard = chooseDiscard(state.hands[seat], state.melds[seat].length);
    const remaining = [...state.hands[seat]];
    remaining.splice(remaining.indexOf(discard), 1);
    if (readyTilesForHand(remaining, state.melds[seat].length).length) {
      markDeclaredTing(state, seat);
    }
  }
  state.hands[seat].splice(state.hands[seat].indexOf(discard), 1);
  registerDiscard(state, seat, discard);
  state.turn = nextSeat(seat);
  state.phase = "claim_or_draw";
  if (state.declared_ting[seat] && log[log.length - 1]?.includes("碰") === false) {
    // Check if we just declared
    const lastLog = log[log.length - 1] || "";
    if (!lastLog.includes("聽牌")) {
      // Was already declared before this action
    }
  }
  log.push(`${SEAT_NAMES[seat]}打出 ${tileName(discard)}。`);
}

// ─── AI turn ───

function runAiTurn(state, seat, log) {
  const { tile: draw, flowers } = drawTile(state, seat);
  if (applyFlowerSpecialIfNeeded(state, seat, log)) return;
  state.hands[seat].push(draw);
  state.hands[seat] = sortedTiles(state.hands[seat]);
  if (flowers.length) {
    log.push(`${SEAT_NAMES[seat]}摸牌，補花 ${flowers.map(tileName).join(" ")}，補進 ${tileName(draw)}。`);
  } else {
    log.push(`${SEAT_NAMES[seat]}摸牌。`);
  }

  const specialContext = flowerSpecialContext(state, seat);
  if (isStandardWin(state.hands[seat], state.melds[seat].length)) {
    const ctx = { kong_draw: flowers.length > 0, ...specialContext };
    if (seat !== state.dealer && state.opening_claim_free && state.seat_turns[seat] === 0) {
      ctx.earth_win = true;
    }
    markWinner(state, seat, "tsumo", { tile: draw, ...ctx });
    clearFlowerSpecialCandidate(state, seat);
    log.push(`${SEAT_NAMES[seat]}自摸 ${tileName(draw)}。`);
    return;
  }
  if (Object.keys(specialContext).length) {
    maybeForceFlowerWin(state, seat, draw, log);
    return;
  }

  let discard;
  if (state.declared_ting[seat]) {
    discard = draw;
  } else {
    discard = chooseDiscard(state.hands[seat], state.melds[seat].length);
    const remaining = [...state.hands[seat]];
    remaining.splice(remaining.indexOf(discard), 1);
    if (readyTilesForHand(remaining, state.melds[seat].length).length) {
      markDeclaredTing(state, seat);
      log.push(`${SEAT_NAMES[seat]}宣告聽牌。`);
    }
  }
  state.hands[seat].splice(state.hands[seat].indexOf(discard), 1);
  registerDiscard(state, seat, discard);
  state.turn = nextSeat(seat);
  state.phase = "claim_or_draw";
  log.push(`${SEAT_NAMES[seat]}打出 ${tileName(discard)}。`);
}

// ─── Resolve after discard ───

function resolveAfterDiscard(state, discarder, tile, log) {
  const userClaims = buildUserClaims(state, discarder, tile);
  const aiClaims = otherClaims(state, discarder, tile);
  if (compareUserClaim(userClaims, aiClaims, discarder)) {
    state.pending_user_action = { from: discarder, tile, options: userClaims };
    state.turn = "east";
    state.phase = "response";
    return true;
  }
  if (aiClaims.length) {
    performAiClaim(state, aiClaims[0], discarder, tile, log);
    return false;
  }
  state.last_discard = { tile, by: discarder };
  state.turn = nextSeat(discarder);
  state.phase = "draw";
  return false;
}

// ─── Draw hand check ───

function maybeFinishDrawHand(state) {
  const remaining = wallRemaining(state);
  if (remaining != null && remaining <= DRAW_RESERVE) {
    state.winner = null;
    state.phase = "ended";
    state.turn = state.dealer;
    handleHandEnd(state);
    return true;
  }
  return false;
}

// ─── Advance until user ───

function advanceUntilUser(state) {
  const log = [];
  while (!state.winner) {
    if (state.phase === "claim_or_draw") {
      const discarder = state.last_discard.by;
      const tile = state.last_discard.tile;
      if (resolveAfterDiscard(state, discarder, tile, log)) {
        return { status: "user_response", log, pending: state.pending_user_action };
      }
      if (state.winner) return { status: "ended", log, winner: state.winner };
      continue;
    }

    if (state.turn === "east") {
      if (state.phase === "draw") {
        if (maybeFinishDrawHand(state)) {
          return { status: "ended", log: [...log, "流局。"], winner: state.winner };
        }
        const { tile: draw, flowers } = drawTile(state, "east");
        if (applyFlowerSpecialIfNeeded(state, "east", log)) {
          return { status: "ended", log, winner: state.winner };
        }
        state.hands.east.push(draw);
        state.hands.east = sortedTiles(state.hands.east);
        const drawSource = flowers.length ? "flower_replacement" : "wall";
        recordLastDraw(state, "east", draw, flowers, drawSource);
        const specialCtx = flowerSpecialContext(state, "east");
        if (Object.keys(specialCtx).length) {
          maybeForceFlowerWin(state, "east", draw, log);
          return { status: "ended", log, winner: state.winner };
        }
        state.phase = "discard";
        return { status: "user_draw", log, draw, flowers };
      }
      if (state.phase === "response") {
        return { status: "user_response", log, pending: state.pending_user_action };
      }
      if (state.phase === "discard") {
        return { status: "user_discard", log };
      }
      throw new Error(`unexpected east phase ${state.phase}`);
    }

    if (state.phase === "draw") {
      if (maybeFinishDrawHand(state)) {
        return { status: "ended", log: [...log, "流局。"], winner: state.winner };
      }
      runAiTurn(state, state.turn, log);
      if (state.winner) return { status: "ended", log, winner: state.winner };
      continue;
    }

    throw new Error(`unexpected phase ${state.phase}`);
  }
  return { status: "ended", log, winner: state.winner };
}

// ─── Initialize hand ───

function takeTileForHandSetup(state, seat) {
  const { tile, flowers } = drawTile(state, seat);
  state.hands[seat].push(tile);
  state.hands[seat] = sortedTiles(state.hands[seat]);
  return { tile, flowers };
}

function initializeHand(state, seed) {
  const dealer = state.dealer;
  state.winner = null;
  state.score_context = {};
  state.declared_ting = Object.fromEntries(SEATS.map(s => [s, false]));
  state.ready_bonus = Object.fromEntries(SEATS.map(s => [s, null]));
  state.seat_turns = Object.fromEntries(SEATS.map(s => [s, 0]));
  state.opening_claim_free = true;
  state.flower_special_candidate = null;
  state.last_draw = null;
  state.last_discard = null;
  delete state.pending_user_action;
  state.hands = Object.fromEntries(SEATS.map(s => [s, []]));
  state.flowers = Object.fromEntries(SEATS.map(s => [s, []]));
  state.melds = Object.fromEntries(SEATS.map(s => [s, []]));
  state.discards = Object.fromEntries(SEATS.map(s => [s, []]));
  state.wall = shuffleWall(seed);
  state.front_index = 0;
  state.back_index = state.wall.length - 1;
  state.turn = dealer;
  state.phase = "draw";

  let lastEastTile = null;
  let lastEastFlowers = [];

  for (const seat of SEATS) {
    const target = seat === dealer ? 17 : 16;
    while (state.hands[seat].length < target) {
      const { tile, flowers } = takeTileForHandSetup(state, seat);
      if (applyFlowerSpecialIfNeeded(state, seat)) {
        if (state.winner) {
          return { status: "ended", log: [`第 ${state.hand_index} 局開始即特胡。`], winner: state.winner };
        }
      }
      if (seat === "east") {
        lastEastTile = tile;
        lastEastFlowers = flowers;
      }
    }
  }

  if (state.flower_special_candidate) {
    const specialSeat = state.flower_special_candidate.seat;
    const winningTile = state.hands[specialSeat].length ? state.hands[specialSeat].at(-1) : null;
    maybeForceFlowerWin(state, specialSeat, winningTile);
    return { status: "ended", log: [`第 ${state.hand_index} 局開始即特胡。`], winner: state.winner };
  }

  if (dealer === "east") {
    state.turn = "east";
    state.phase = "discard";
    if (lastEastTile != null) recordLastDraw(state, "east", lastEastTile, lastEastFlowers, "deal");
    if (isStandardWin(state.hands.east, state.melds.east.length)) {
      state.score_context.heaven_win = true;
    }
  } else {
    state.turn = dealer;
    state.phase = "discard";
    if (isStandardWin(state.hands[dealer], state.melds[dealer].length)) {
      markWinner(state, dealer, "tsumo", { tile: state.hands[dealer].at(-1), heaven_win: true });
      return { status: "ended", log: [`${SEAT_NAMES[dealer]}天胡。`], winner: state.winner };
    }
    const firstTile = chooseDiscard(state.hands[dealer], state.melds[dealer].length);
    const remaining = [...state.hands[dealer]];
    remaining.splice(remaining.indexOf(firstTile), 1);
    if (readyTilesForHand(remaining, state.melds[dealer].length).length) {
      markDeclaredTing(state, dealer);
    }
    state.hands[dealer].splice(state.hands[dealer].indexOf(firstTile), 1);
    registerDiscard(state, dealer, firstTile);
    state.turn = nextSeat(dealer);
    state.phase = "claim_or_draw";
    const initialLog = [];
    if (state.declared_ting[dealer]) initialLog.push(`${SEAT_NAMES[dealer]}宣告聽牌。`);
    initialLog.push(`${SEAT_NAMES[dealer]}打出 ${tileName(firstTile)}。`);
    const result = resolveAfterDiscard(state, dealer, firstTile, initialLog);
    if (result) {
      return { status: "user_response", log: initialLog, pending: state.pending_user_action };
    }
    const advance = advanceUntilUser(state);
    advance.log = [...initialLog, ...advance.log];
    return advance;
  }

  return {
    status: "user_discard",
    log: [`第 ${state.hand_index} 局開始，${SEAT_NAMES[dealer]}坐莊。`],
  };
}

// ─── Match progression ───

function advanceMatchMetadata(state) {
  const dealer = state.dealer;
  const winner = state.winner;
  const dealerHolds = winner == null || (winner && winner.seat === dealer);
  if (dealerHolds) {
    state.dealer_streak = (state.dealer_streak || 0) + 1;
    state.hand_index = (state.hand_index || 1) + 1;
    return true;
  }
  if (dealer === "north") {
    state.match_complete = true;
    state.phase = "match_complete";
    state.turn = null;
    state.winner = null;
    state.last_draw = null;
    state.last_discard = null;
    delete state.pending_user_action;
    return false;
  }
  const nextDealer = nextSeat(dealer);
  state.dealer = nextDealer;
  state.round_wind = nextDealer;
  state.dealer_streak = 0;
  state.hand_index = (state.hand_index || 1) + 1;
  return true;
}

function nextHand(state, seed) {
  if (state.match_complete) throw new Error("整場已結束");
  if (state.phase !== "ended") throw new Error("目前牌局尚未結束");
  const advance = advanceMatchMetadata(state);
  if (!advance) {
    return { status: "match_complete", log: ["整場結束。"], summary: state.last_hand_summary };
  }
  state.winner = null;
  state.phase = "setup";
  state.turn = state.dealer;
  return initializeHand(state, seed);
}

function startMatch(seed, logDir, ruleset = DEFAULT_RULESET) {
  const matchId = randomUUID().replace(/-/g, "").slice(0, 10);
  const resolvedLogDir = logDir || join(DEFAULT_LOG_DIR, matchId);
  const state = newEmptyState(matchId, resolvedLogDir, ruleset);
  const result = initializeHand(state, seed);
  const root = logRoot(state);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "match.json"), JSON.stringify({
    match_id: state.match_id,
    variant: state.variant,
    ruleset: state.ruleset,
    log_dir: root,
    started_at: nowISO(),
  }, null, 2), "utf-8");
  return { state, result };
}

function newEmptyState(matchId, logDir, ruleset) {
  const state = {
    variant: "taiwan-16",
    ruleset,
    match_id: matchId,
    match_complete: false,
    hand_index: 1,
    round_wind: "east",
    dealer: "east",
    dealer_streak: 0,
    turn: "east",
    phase: "setup",
    score_context: {},
    winner: null,
    last_hand_summary: null,
    log_dir: logDir,
    hands: Object.fromEntries(SEATS.map(s => [s, []])),
    flowers: Object.fromEntries(SEATS.map(s => [s, []])),
    melds: Object.fromEntries(SEATS.map(s => [s, []])),
    discards: Object.fromEntries(SEATS.map(s => [s, []])),
    wall: [],
    front_index: 0,
    back_index: -1,
  };
  ensureStateDefaults(state);
  return state;
}

// ─── User actions ───

function userDiscard(state, rawTile, declareTing = false) {
  const tile = parseTile(rawTile);
  if (state.turn !== "east" || state.phase !== "discard") throw new Error("現在不是你打牌的時機");
  const hand = state.hands.east;
  if (!hand.includes(tile)) throw new Error(`你手上沒有 ${tileName(tile)}`);
  if (state.declared_ting.east) {
    const drawTileCode = state.last_draw?.tile;
    if (drawTileCode && tile !== drawTileCode) throw new Error("聽牌後只能打出剛摸進來的牌");
  }
  if (declareTing) {
    if (state.declared_ting.east) throw new Error("你已經宣告聽牌");
    if (!canDeclareTing(hand, state.melds.east.length, tile)) throw new Error("打出這張後並未形成聽牌");
    markDeclaredTing(state, "east");
  }
  hand.splice(hand.indexOf(tile), 1);
  registerDiscard(state, "east", tile);
  state.turn = "south";
  state.phase = "claim_or_draw";
  const initialLog = [];
  if (declareTing) initialLog.push("你宣告聽牌。");
  const result = resolveAfterDiscard(state, "east", tile, initialLog);
  if (result) {
    return { status: "user_response", log: initialLog, pending: state.pending_user_action, discard: tile };
  }
  const advance = advanceUntilUser(state);
  advance.log = [...initialLog, ...advance.log];
  advance.discard = tile;
  return advance;
}

function resolveUserAction(state, action, chowIndex, discardRaw) {
  const pending = state.pending_user_action;
  if (!pending) {
    if (action === "hu" && userCanSelfDrawHu(state)) {
      const lastDraw = state.last_draw || {};
      const winningTile = lastDraw.tile;
      const specialContext = {
        kong_draw: ["kong_replacement", "flower_replacement"].includes(lastDraw.source),
        ...flowerSpecialContext(state, "east"),
      };
      if (lastDraw.source === "deal" && state.dealer === "east" && state.seat_turns.east === 0) {
        specialContext.heaven_win = true;
      } else if (earthWinAvailable(state, "east")) {
        specialContext.earth_win = true;
      }
      markWinner(state, "east", "tsumo", { tile: winningTile, ...specialContext });
      clearFlowerSpecialCandidate(state, "east");
      return {
        status: "ended",
        log: [winningTile ? `你自摸了 ${tileName(winningTile)}。` : "你自摸了。"],
        winner: state.winner,
      };
    }
    throw new Error("目前沒有等待你的吃碰決定");
  }

  const tile = pending.tile;
  const discarder = pending.from;
  const options = pending.options;

  if (action === "pass") {
    delete state.pending_user_action;
    const aiClaims = otherClaims(state, discarder, tile);
    if (aiClaims.length) {
      const log = [];
      performAiClaim(state, aiClaims[0], discarder, tile, log);
      const result = advanceUntilUser(state);
      result.log = [...log, ...result.log];
      return result;
    }
    state.turn = nextSeat(discarder);
    state.phase = "draw";
    delete state.pending_user_action;
    return advanceUntilUser(state);
  }

  const chosen = options.find(o => o.type === action);
  if (!chosen) throw new Error(`你現在不能 ${action}`);

  const log = [];
  if (action === "hu") {
    const specialContext = {};
    if (humanWinAvailable(state, "east", discarder)) specialContext.human_win = true;
    markWinner(state, "east", "ron", { tile, from_seat: discarder, ...specialContext });
    delete state.pending_user_action;
    return { status: "ended", log: [`你胡了 ${SEAT_NAMES[discarder]} 的 ${tileName(tile)}。`], winner: state.winner };
  }

  if (action === "pong") {
    markOpeningBroken(state);
    state.hands.east.splice(state.hands.east.indexOf(tile), 1);
    state.hands.east.splice(state.hands.east.indexOf(tile), 1);
    state.melds.east.push({ type: "pong", tiles: [tile, tile, tile], from: discarder });
    log.push(`你碰了 ${tileName(tile)}。`);
  } else if (action === "kong") {
    markOpeningBroken(state);
    for (let i = 0; i < 3; i++) state.hands.east.splice(state.hands.east.indexOf(tile), 1);
    state.melds.east.push({ type: "kong", tiles: [tile, tile, tile, tile], from: discarder });
    const { tile: supplement, flowers } = drawTile(state, "east", true);
    if (applyFlowerSpecialIfNeeded(state, "east", log)) {
      delete state.pending_user_action;
      return { status: "ended", log, winner: state.winner };
    }
    state.hands.east.push(supplement);
    state.hands.east = sortedTiles(state.hands.east);
    recordLastDraw(state, "east", supplement, flowers, "kong_replacement");
    log.push(`你明槓 ${tileName(tile)}，補進 ${tileName(supplement)}。`);
    if (flowers.length) log.push(`補花 ${flowers.map(tileName).join(" ")}。`);
  } else if (action === "chow") {
    markOpeningBroken(state);
    const chowOptionsOnly = options.filter(o => o.type === "chow");
    if (chowIndex == null || chowIndex < 1 || chowIndex > chowOptionsOnly.length) {
      throw new Error("請指定要吃的組合");
    }
    const chosenChow = chowOptionsOnly[chowIndex - 1];
    const combo = chosenChow.tiles;
    for (const usedTile of combo) {
      if (usedTile !== tile) {
        state.hands.east.splice(state.hands.east.indexOf(usedTile), 1);
      }
    }
    state.melds.east.push({ type: "chow", tiles: combo, from: discarder });
    log.push(`你吃了 ${combo.map(tileName).join(" ")}。`);
  }

  state.hands.east = sortedTiles(state.hands.east);
  delete state.pending_user_action;
  state.turn = "east";
  state.phase = "discard";

  if (Object.keys(flowerSpecialContext(state, "east")).length) {
    maybeForceFlowerWin(state, "east", state.last_draw?.tile, log);
    return { status: "ended", log, winner: state.winner };
  }
  if (isStandardWin(state.hands.east, state.melds.east.length)) {
    if (action === "kong") {
      markWinner(state, "east", "tsumo", { tile: state.last_draw?.tile, kong_draw: true });
    } else {
      markWinner(state, "east", "win_after_claim", { tile, from_seat: discarder });
    }
    return { status: "ended", log: [...log, "你已成胡。"], winner: state.winner };
  }

  if (discardRaw != null) {
    const discardResult = userDiscard(state, discardRaw);
    discardResult.log = [...log, ...discardResult.log];
    return discardResult;
  }

  return { status: "need_discard", log };
}

// ─── Print result ───

function printResult(state, result) {
  const output = publicView(state);
  output.status = result.status;
  output.log = result.log;
  if (result.summary) output.summary = result.summary;
  if (result.discard) output.discard = tileName(result.discard);
  if (result.status === "user_draw") {
    output.draw = tileName(result.draw);
    output.flowers_drawn = result.flowers.map(tileName);
  }
  console.log(JSON.stringify(output, null, 2));
}

// ─── CLI ───

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("Usage: node mahjong_engine.js <command> [args]");
    process.exit(1);
  }

  const command = args[0];

  function getArg(name) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  }

  if (command === "new-match") {
    const seed = getArg("seed") != null ? parseInt(getArg("seed")) : undefined;
    const logDir = getArg("log-dir");
    const ruleset = getArg("ruleset") || DEFAULT_RULESET;
    const { state, result } = startMatch(seed, logDir, ruleset);
    saveState(state);
    writeLogs(state, "new-match", result);
    printResult(state, result);
    return;
  }

  const state = loadState();

  if (command === "view") {
    console.log(JSON.stringify(publicView(state), null, 2));
    return;
  }
  if (command === "score") {
    console.log(JSON.stringify(scoreSummary(state), null, 2));
    return;
  }
  if (command === "next-hand") {
    const seed = getArg("seed") != null ? parseInt(getArg("seed")) : undefined;
    const result = nextHand(state, seed);
    saveState(state);
    writeLogs(state, "next-hand", result);
    printResult(state, result);
    return;
  }
  if (command === "discard") {
    const tile = args[1];
    if (!tile) { console.error("Usage: discard <tile>"); process.exit(1); }
    const result = userDiscard(state, tile);
    saveState(state);
    writeLogs(state, "discard", result);
    printResult(state, result);
    return;
  }
  if (command === "ting") {
    const tile = args[1];
    if (!tile) { console.error("Usage: ting <tile>"); process.exit(1); }
    const result = userDiscard(state, tile, true);
    saveState(state);
    writeLogs(state, "ting", result);
    printResult(state, result);
    return;
  }
  if (command === "action") {
    const action = args[1];
    if (!action) { console.error("Usage: action <pass|pong|kong|chow|hu>"); process.exit(1); }
    const chowIndex = getArg("chow-index") != null ? parseInt(getArg("chow-index")) : null;
    const discardRaw = getArg("discard");
    const result = resolveUserAction(state, action, chowIndex, discardRaw);
    saveState(state);
    writeLogs(state, "action", result);
    printResult(state, result);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main();
