// mahjong_scoring.js — Taiwan 16-tile scoring (Pocket Funclub rules)
// Ported from mahjong_scoring.py

const SEATS = ["east", "south", "west", "north"];
const WIND_TILES = { east: "E", south: "S", west: "W", north: "N" };
const DRAGON_TILES = new Set(["C", "F", "P"]);
const FLOWER_WIND_MAP = {
  H1: "east", H2: "south", H3: "west", H4: "north",
  H5: "east", H6: "south", H7: "west", H8: "north",
};
const ALL_PLAYABLE_TILES = [
  ...["m", "p", "s"].flatMap(suit =>
    Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`)
  ),
  "E", "S", "W", "N", "C", "F", "P",
];
const DEFAULT_RULESET = "pocket-funclub";
const RULESET_METADATA = {
  [DEFAULT_RULESET]: {
    name: "Pocket Mahjong 16-tile Taiwan rules",
    source: "https://pocket.funclub.com.tw/rule",
  },
};

function sortKey(tile) {
  if (tile.endsWith("m") || tile.endsWith("p") || tile.endsWith("s")) {
    const suitOrder = { m: 0, p: 1, s: 2 };
    return [0, suitOrder[tile.at(-1)], parseInt(tile.slice(0, -1))];
  }
  const honorOrder = { E: 0, S: 1, W: 2, N: 3, C: 4, F: 5, P: 6 };
  return [1, honorOrder[tile], 0];
}

function compareTiles(a, b) {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

function sortedTiles(tiles) {
  return [...tiles].sort(compareTiles);
}

function nextSeat(seat) {
  return SEATS[(SEATS.indexOf(seat) + 1) % 4];
}

function seatWind(seat, dealer) {
  return SEATS[(SEATS.indexOf(seat) - SEATS.indexOf(dealer) + 4) % 4];
}

function isSuited(tile) {
  return tile.endsWith("m") || tile.endsWith("p") || tile.endsWith("s");
}

function isHonor(tile) {
  return Object.values(WIND_TILES).includes(tile) || DRAGON_TILES.has(tile);
}

function meldKind(tiles) {
  if (tiles.length === 4) return "kong";
  if (tiles[0] === tiles[1] && tiles[1] === tiles[2]) return "pong";
  return "chow";
}

function counterFrom(tiles) {
  const c = {};
  for (const t of tiles) c[t] = (c[t] || 0) + 1;
  return c;
}

function counterHasAny(counter) {
  return Object.values(counter).some(v => v > 0);
}

function isStandardWin(tiles, meldCount) {
  const targetMelds = 5 - meldCount;
  if (tiles.length !== targetMelds * 3 + 2) return false;

  const counts = counterFrom(tiles);

  function canFormAllSets(counter, remainingMelds) {
    if (remainingMelds === 0) return !counterHasAny(counter);

    let tile = null;
    for (const candidate of Object.keys(counter).sort(compareTiles)) {
      if (counter[candidate] > 0) { tile = candidate; break; }
    }
    if (tile === null) return false;

    if (counter[tile] >= 3) {
      counter[tile] -= 3;
      if (canFormAllSets(counter, remainingMelds - 1)) {
        counter[tile] += 3;
        return true;
      }
      counter[tile] += 3;
    }

    if (isSuited(tile)) {
      const number = parseInt(tile.slice(0, -1));
      const suit = tile.at(-1);
      const second = `${number + 1}${suit}`;
      const third = `${number + 2}${suit}`;
      if (number <= 7 && (counter[second] || 0) > 0 && (counter[third] || 0) > 0) {
        counter[tile] -= 1;
        counter[second] = (counter[second] || 0) - 1;
        counter[third] = (counter[third] || 0) - 1;
        if (canFormAllSets(counter, remainingMelds - 1)) {
          counter[tile] += 1;
          counter[second] += 1;
          counter[third] += 1;
          return true;
        }
        counter[tile] += 1;
        counter[second] += 1;
        counter[third] += 1;
      }
    }

    return false;
  }

  for (const [pairTile, count] of Object.entries(counts)) {
    if (count < 2) continue;
    counts[pairTile] -= 2;
    if (canFormAllSets(counts, targetMelds)) {
      counts[pairTile] += 2;
      return true;
    }
    counts[pairTile] += 2;
  }
  return false;
}

function findStandardDecompositions(tiles, openMeldCount) {
  const targetMelds = 5 - openMeldCount;
  if (tiles.length !== targetMelds * 3 + 2) return [];

  const counts = counterFrom(tiles);
  const results = [];
  const seen = new Set();

  function walk(counter, remainingMelds, pairTile, melds) {
    if (remainingMelds === 0) {
      if (counterHasAny(counter)) return;
      const key = JSON.stringify([pairTile, [...melds].map(m => [...m]).sort()]);
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        pair: pairTile,
        melds: melds
          .map(m => [...m])
          .sort((a, b) => {
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
              const c = compareTiles(a[i], b[i]);
              if (c !== 0) return c;
            }
            return a.length - b.length;
          }),
      });
      return;
    }

    let tile = null;
    for (const candidate of Object.keys(counter).sort(compareTiles)) {
      if (counter[candidate] > 0) { tile = candidate; break; }
    }
    if (tile === null) return;

    if (counter[tile] >= 3) {
      counter[tile] -= 3;
      walk(counter, remainingMelds - 1, pairTile, [...melds, sortedTiles([tile, tile, tile])]);
      counter[tile] += 3;
    }

    if (isSuited(tile)) {
      const number = parseInt(tile.slice(0, -1));
      const suit = tile.at(-1);
      const second = `${number + 1}${suit}`;
      const third = `${number + 2}${suit}`;
      if (number <= 7 && (counter[second] || 0) > 0 && (counter[third] || 0) > 0) {
        counter[tile] -= 1;
        counter[second] = (counter[second] || 0) - 1;
        counter[third] = (counter[third] || 0) - 1;
        walk(counter, remainingMelds - 1, pairTile, [...melds, sortedTiles([tile, second, third])]);
        counter[tile] += 1;
        counter[second] += 1;
        counter[third] += 1;
      }
    }
  }

  for (const pairTile of Object.keys(counts).sort(compareTiles)) {
    if (counts[pairTile] < 2) continue;
    counts[pairTile] -= 2;
    walk(counts, targetMelds, pairTile, []);
    counts[pairTile] += 2;
  }

  return results;
}

function removeOneTile(tiles, tile) {
  const next = [...tiles];
  const idx = next.indexOf(tile);
  if (idx !== -1) next.splice(idx, 1);
  return next;
}

function normalizeOpenMelds(melds) {
  return melds.map(meld => {
    const tiles = sortedTiles(meld.tiles);
    return {
      kind: meldKind(tiles),
      tiles,
      open: !meld.concealed,
      counts_as_concealed_triplet: false,
    };
  });
}

function normalizeCandidateMelds(candidateMelds, winningTile, selfDraw, prewinCounts) {
  return candidateMelds.map(meld => {
    const kind = meldKind(meld);
    let countsAsConcealedTriplet = false;
    if (kind === "pong") {
      countsAsConcealedTriplet = true;
      if (!selfDraw && meld[0] === winningTile && (prewinCounts[winningTile] || 0) < 3) {
        countsAsConcealedTriplet = false;
      }
    }
    return {
      kind,
      tiles: meld,
      open: false,
      counts_as_concealed_triplet: countsAsConcealedTriplet,
    };
  });
}

function addBreakdown(breakdown, name, tai, detail = null) {
  const entry = { name, tai };
  if (detail) entry.detail = detail;
  breakdown.push(entry);
}

function countTriplets(allMelds, tile) {
  return allMelds.filter(
    m => (m.kind === "pong" || m.kind === "kong") && m.tiles[0] === tile
  ).length;
}

function allTilesForWinner(state, seat) {
  const winner = state.winner;
  let concealed = [...state.hands[seat]];
  if (["ron", "rob_kong", "human"].includes(winner.type) && winner.tile) {
    concealed = [...concealed, winner.tile];
  }
  return sortedTiles(concealed);
}

function prewinTiles(state, seat) {
  const winner = state.winner;
  const concealed = [...state.hands[seat]];
  if (["ron", "rob_kong", "human"].includes(winner.type)) {
    return sortedTiles(concealed);
  }
  return sortedTiles(removeOneTile(concealed, winner.tile));
}

function waitCandidates(tiles, openMeldCount) {
  const winners = [];
  for (const tile of ALL_PLAYABLE_TILES) {
    if (isStandardWin(sortedTiles([...tiles, tile]), openMeldCount)) {
      winners.push(tile);
    }
  }
  return winners;
}

function visibleTileCount(state) {
  if (state.front_index == null || state.back_index == null) return null;
  return Math.max(state.back_index - state.front_index + 1, 0);
}

function inferSpecialContext(state, seat) {
  const context = { ...(state.score_context || {}) };
  const declaredTing = (state.declared_ting || {})[seat];
  const readyBonus = (state.ready_bonus || {})[seat];
  if (declaredTing) context.declared_ting = true;
  if (readyBonus) context[readyBonus] = true;
  const remaining = visibleTileCount(state);
  const winner = state.winner;
  const selfDraw = winner.type === "tsumo";
  if (remaining === 0 && !context.last_tile_draw && selfDraw) {
    context.last_tile_draw = true;
  }
  if (remaining === 0 && !context.last_tile_discard && !selfDraw) {
    context.last_tile_discard = true;
  }
  return context;
}

function contextExclusions(context) {
  const excluded = new Set();
  if (context.heaven_win) {
    ["門清", "自摸", "門清自摸", "槓上開花"].forEach(s => excluded.add(s));
  }
  if (context.earth_win) {
    ["門清", "自摸", "門清自摸"].forEach(s => excluded.add(s));
  }
  if (context.human_win) excluded.add("門清");
  if (context.heaven_ready) {
    ["門清", "聽牌"].forEach(s => excluded.add(s));
  }
  if (context.earth_ready) excluded.add("聽牌");
  return excluded;
}

function contextHasFlowerForcedWin(context) {
  return context.eight_flowers || context.seven_rob_one;
}

function evaluateCandidate(state, seat, candidate) {
  const winner = state.winner;
  const dealer = state.dealer || "east";
  const roundWind = state.round_wind || "east";
  const dealerStreak = state.dealer_streak || 0;
  const context = inferSpecialContext(state, seat);
  const exclusions = contextExclusions(context);
  const flowers = sortedTiles(state.flowers[seat]);
  const openMelds = normalizeOpenMelds(state.melds[seat]);
  const fullConcealed = allTilesForWinner(state, seat);
  const prewin = prewinTiles(state, seat);
  const winningTile = winner.tile;
  const selfDraw = winner.type === "tsumo";
  const prewinCounts = counterFrom(prewin);
  const concealedMelds = normalizeCandidateMelds(candidate.melds, winningTile, selfDraw, prewinCounts);
  const allMelds = [...openMelds, ...concealedMelds];
  const allTiles = [...fullConcealed, ...openMelds.flatMap(m => m.tiles)];
  const pairTile = candidate.pair;
  const breakdown = [];

  const windTriplets = {};
  for (const tile of Object.values(WIND_TILES)) {
    windTriplets[tile] = countTriplets(allMelds, tile);
  }
  const dragonTriplets = {};
  for (const tile of DRAGON_TILES) {
    dragonTriplets[tile] = countTriplets(allMelds, tile);
  }
  const allTripletsFlag = allMelds.every(m => m.kind === "pong" || m.kind === "kong");
  const concealedTriplets = allMelds.filter(m => m.counts_as_concealed_triplet).length;
  const onlyHonors = allTiles.every(t => isHonor(t));
  const suitedTilesArr = allTiles.filter(t => isSuited(t));
  const honorTilesArr = allTiles.filter(t => isHonor(t));
  const suits = new Set(suitedTilesArr.map(t => t.at(-1)));
  const pureOneSuit = suitedTilesArr.length > 0 && suits.size === 1 && honorTilesArr.length === 0;
  const mixedOneSuit = suitedTilesArr.length > 0 && suits.size === 1 && honorTilesArr.length > 0;
  const seatWindTile = WIND_TILES[seatWind(seat, dealer)];
  const roundWindTile = WIND_TILES[roundWind];
  const waitTiles = waitCandidates(prewin, openMelds.length);
  const seatIsDealer = seat === dealer;
  const discarderIsDealer = winner.from === dealer;
  const hasAllOpenMelds = openMelds.length === 5;
  const pairIsDragon = DRAGON_TILES.has(pairTile);
  const pairIsWind = Object.values(WIND_TILES).includes(pairTile);
  const bigThreeDragons = [...DRAGON_TILES].every(t => dragonTriplets[t] > 0);
  const smallThreeDragons = [...DRAGON_TILES].filter(t => dragonTriplets[t] > 0).length === 2 && pairIsDragon;
  const bigFourWinds = Object.values(WIND_TILES).every(t => windTriplets[t] > 0);
  const smallFourWinds = Object.values(WIND_TILES).filter(t => windTriplets[t] > 0).length === 3 && pairIsWind;
  const allSequences = allMelds.every(m => m.kind === "chow");
  const pingHu = allSequences && honorTilesArr.length === 0 && flowers.length === 0 && !selfDraw;

  // Context-based patterns
  if (context.heaven_win) addBreakdown(breakdown, "天胡", 24);
  if (context.earth_win) addBreakdown(breakdown, "地胡", 16);
  if (context.heaven_ready) addBreakdown(breakdown, "天聽", 16);
  if (context.human_win) addBreakdown(breakdown, "人胡", 8);
  if (context.earth_ready) addBreakdown(breakdown, "地聽", 8);
  if (context.eight_flowers || flowers.length >= 8) addBreakdown(breakdown, "八仙過海", 8);
  if (context.seven_rob_one) addBreakdown(breakdown, "七搶一", 8);

  // Hand-based patterns
  if (bigFourWinds) addBreakdown(breakdown, "大四喜", 16);
  if (onlyHonors) addBreakdown(breakdown, "字一色", 16);
  if (pureOneSuit) addBreakdown(breakdown, "清一色", 8);
  if (smallFourWinds) addBreakdown(breakdown, "小四喜", 8);
  if (bigThreeDragons) addBreakdown(breakdown, "大三元", 8);
  if (concealedTriplets >= 5) addBreakdown(breakdown, "五暗刻", 8);
  if (concealedTriplets >= 4) addBreakdown(breakdown, "四暗刻", 5);
  if (allTripletsFlag && !onlyHonors) addBreakdown(breakdown, "碰碰胡", 4);
  if (mixedOneSuit) addBreakdown(breakdown, "混一色", 4);
  if (smallThreeDragons) addBreakdown(breakdown, "小三元", 4);
  if (pingHu) addBreakdown(breakdown, "平胡", 2);
  if (concealedTriplets >= 3) addBreakdown(breakdown, "三暗刻", 2);

  // Dealer
  if (seatIsDealer || discarderIsDealer) addBreakdown(breakdown, "莊家", 1);
  if (dealerStreak && (seatIsDealer || discarderIsDealer)) {
    addBreakdown(breakdown, "連莊", dealerStreak * 2, `${dealerStreak} 連拉`);
  }

  // Self-draw / concealed
  if (selfDraw) {
    if (openMelds.length === 0 && !exclusions.has("門清自摸")) {
      addBreakdown(breakdown, "門清自摸", 3);
    } else if (!exclusions.has("自摸")) {
      addBreakdown(breakdown, "自摸", 1);
    }
  } else if (openMelds.length === 0 && !exclusions.has("門清")) {
    addBreakdown(breakdown, "門清", 1);
  }

  // All open melds
  if (hasAllOpenMelds && !selfDraw) addBreakdown(breakdown, "全求人", 2);
  if (hasAllOpenMelds && selfDraw) addBreakdown(breakdown, "半求人", 1);

  // Situational
  if (context.kong_draw && !exclusions.has("槓上開花")) addBreakdown(breakdown, "槓上開花", 1);
  if (context.last_tile_draw) addBreakdown(breakdown, "海底撈月", 1);
  if (context.last_tile_discard) addBreakdown(breakdown, "河底撈魚", 1);
  if (context.rob_kong) addBreakdown(breakdown, "搶槓", 1);
  if (context.declared_ting && !exclusions.has("聽牌")) addBreakdown(breakdown, "聽牌", 1);
  if (waitTiles.length === 1) addBreakdown(breakdown, "獨聽", 1);

  // Dragons (individual, only if not big/small three dragons)
  if (!bigThreeDragons && !smallThreeDragons) {
    if (dragonTriplets["C"] > 0) addBreakdown(breakdown, "紅中", 1);
    if (dragonTriplets["F"] > 0) addBreakdown(breakdown, "青發", 1);
    if (dragonTriplets["P"] > 0) addBreakdown(breakdown, "白板", 1);
  }

  // Flower set
  const flowerSetOne = new Set(["H1", "H2", "H3", "H4"]);
  const flowerSetTwo = new Set(["H5", "H6", "H7", "H8"]);
  const flowerCounter = new Set(flowers);
  if ([...flowerSetOne].every(f => flowerCounter.has(f)) ||
      [...flowerSetTwo].every(f => flowerCounter.has(f))) {
    addBreakdown(breakdown, "花槓", 1);
  }

  // Wind triplets
  if (windTriplets[roundWindTile] > 0) addBreakdown(breakdown, "圈風", 1);
  if (windTriplets[seatWindTile] > 0) addBreakdown(breakdown, "門風", 1);
  if (flowers.some(t => FLOWER_WIND_MAP[t] === seatWind(seat, dealer))) {
    addBreakdown(breakdown, "門花", 1);
  }

  const total = breakdown.reduce((sum, item) => sum + item.tai, 0);
  return {
    breakdown: breakdown.sort((a, b) => b.tai - a.tai || a.name.localeCompare(b.name)),
    pair: pairTile,
    wait_tiles: sortedTiles(waitTiles),
    total_tai: total,
  };
}

function evaluateFlowerOnly(state, seat) {
  const context = inferSpecialContext(state, seat);
  const winner = state.winner;
  const dealer = state.dealer || "east";
  const dealerStreak = state.dealer_streak || 0;
  const breakdown = [];
  const seatIsDealer = seat === dealer;
  const discarderIsDealer = winner.from === dealer;

  if (context.eight_flowers) addBreakdown(breakdown, "八仙過海", 8);
  if (context.seven_rob_one) addBreakdown(breakdown, "七搶一", 8);
  if (seatIsDealer || discarderIsDealer) addBreakdown(breakdown, "莊家", 1);
  if (dealerStreak && (seatIsDealer || discarderIsDealer)) {
    addBreakdown(breakdown, "連莊", dealerStreak * 2, `${dealerStreak} 連拉`);
  }

  const total = breakdown.reduce((sum, item) => sum + item.tai, 0);
  return {
    breakdown: breakdown.sort((a, b) => b.tai - a.tai || a.name.localeCompare(b.name)),
    pair: null,
    wait_tiles: [],
    total_tai: total,
  };
}

function scoreState(state, ruleset = DEFAULT_RULESET) {
  if (!RULESET_METADATA[ruleset]) {
    throw new Error(`Unsupported ruleset: ${ruleset}`);
  }
  if (!state.winner) {
    throw new Error("Cannot score a hand without a winner.");
  }

  const seat = state.winner.seat;
  const candidateTiles = allTilesForWinner(state, seat);
  const openMeldCount = state.melds[seat].length;
  const decompositions = findStandardDecompositions(candidateTiles, openMeldCount);
  const context = inferSpecialContext(state, seat);

  if (decompositions.length === 0) {
    if (contextHasFlowerForcedWin(context)) {
      const best = evaluateFlowerOnly(state, seat);
      return {
        ruleset,
        ruleset_name: RULESET_METADATA[ruleset].name,
        source: RULESET_METADATA[ruleset].source,
        winner: state.winner,
        winner_seat_wind: seatWind(seat, state.dealer || "east"),
        total_tai: best.total_tai,
        breakdown: best.breakdown,
        wait_tiles: best.wait_tiles,
      };
    }
    throw new Error("Winning hand does not form a supported standard 16-tile hand.");
  }

  const scored = decompositions.map(c => evaluateCandidate(state, seat, c));
  const best = scored.reduce((a, b) => {
    if (b.total_tai > a.total_tai) return b;
    if (b.total_tai < a.total_tai) return a;
    if (b.breakdown.length > a.breakdown.length) return b;
    return a;
  });

  return {
    ruleset,
    ruleset_name: RULESET_METADATA[ruleset].name,
    source: RULESET_METADATA[ruleset].source,
    winner: state.winner,
    winner_seat_wind: seatWind(seat, state.dealer || "east"),
    total_tai: best.total_tai,
    breakdown: best.breakdown,
    wait_tiles: best.wait_tiles,
  };
}

export {
  SEATS,
  WIND_TILES,
  DRAGON_TILES,
  FLOWER_WIND_MAP,
  ALL_PLAYABLE_TILES,
  DEFAULT_RULESET,
  RULESET_METADATA,
  sortKey,
  compareTiles,
  sortedTiles,
  nextSeat,
  seatWind,
  isSuited,
  isHonor,
  meldKind,
  counterFrom,
  isStandardWin,
  findStandardDecompositions,
  removeOneTile,
  normalizeOpenMelds,
  normalizeCandidateMelds,
  waitCandidates,
  scoreState,
};
