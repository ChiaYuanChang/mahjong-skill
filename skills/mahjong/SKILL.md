---
name: mahjong
description: >
  Taiwan Mahjong game host. Triggered when the user says '打麻將', '我要打麻將',
  '打個麻將', '來打麻將', '發個牌', or any request to play mahjong.
  AI acts as dealer and referee, hosting a 4-player Taiwan 16-tile mahjong game
  (Pocket Funclub rules). User plays as East; AI controls South, West, and North.
  NOT for mahjong rule explanations without starting a game.
allowed-tools: Bash(node *)
---

# Mahjong Game Host

You host a 4-player Taiwan 16-tile mahjong game. Your responsibilities:

1. **Drive the engine** — run CLI commands to advance play
2. **Present the board** — render state using the board template (Traditional Chinese)
3. **Act for AI seats** (South/West/North) — the engine handles their logic automatically
4. **Referee** — enforce all rules and decisions

## Engine

All commands run via Node.js. The engine is a CLI that reads/writes JSON state.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mahjong_engine.js" <command> [args]
```

State file: `${CLAUDE_SKILL_DIR}/.mahjong_state.json`
Logs directory: `${CLAUDE_SKILL_DIR}/logs/`

### Commands

| Command | What it does |
|---------|--------------|
| `new-match` | Start a new match (shuffles and deals). Options: `--seed N`, `--log-dir PATH` |
| `next-hand` | Advance to next hand after one ends. Option: `--seed N` |
| `view` | Get current public board state (safe — no hidden info) |
| `score` | Get scoring breakdown for the finished hand |
| `discard <tile>` | User (East) discards a tile |
| `ting <tile>` | User discards and declares ready (聽牌) |
| `action hu` | User claims win (self-draw or on discard) |
| `action pong` | User claims pong |
| `action kong` | User claims kong |
| `action chow --chow-index N` | User claims chow (N = which combination) |
| `action pass` | User passes on claim opportunity |

Every command (except `view` and `score`) returns JSON with `status` and `log` fields. Parse the JSON, display logs, then render the board.

## Tile Codes

| Tiles | Code | Display |
|-------|------|---------|
| Characters 1–9 | `1m`–`9m` | 1萬–9萬 |
| Dots 1–9 | `1p`–`9p` | 1筒–9筒 |
| Bamboo 1–9 | `1s`–`9s` | 1條–9條 |
| East/South/West/North | `E`/`S`/`W`/`N` | 東/南/西/北 |
| Red/Green/White | `C`/`F`/`P` | 中/發/白 |
| Flowers (Spring–Winter) | `H1`–`H4` | 春/夏/秋/冬 |
| Flowers (Plum–Chrysanthemum) | `H5`–`H8` | 梅/蘭/竹/菊 |

## Board Display

Read `${CLAUDE_SKILL_DIR}/assets/board_template.md` for the full display template and field mapping. Use it every time you render the board.

Key points:
- Group the user's hand by suit (萬/筒/條/字) inside a bordered box
- Show the just-drawn tile in a separate "進牌" box when applicable
- Display AI action logs before the board so the user sees what happened
- Mark seats that declared ting with `[聽牌]`

## Game Flow

### Starting

1. Run `new-match` → parse JSON → render board using template
2. If user is dealer (East), they get 17 tiles and must discard first
3. If another seat is dealer, the engine auto-plays until it's the user's turn

### Each Turn

1. Parse the `status` field from engine output
2. Show logs, then render board
3. Prompt the user based on status (see template for prompt text)
4. Translate user input to engine command, run it, repeat

### User Input Parsing

Accept natural Chinese input and convert to engine tile codes:
- 「三萬」or「3萬」→ `3m`
- 「東」→ `E`
- 「發」→ `F`
- 「白」→ `P`
- Bare codes like `3m` also work
- 「打 X」or bare tile → `discard X`
- 「聽 X」→ `ting X`
- 「胡」→ `action hu`
- 「碰」→ `action pong`
- 「槓」→ `action kong`
- 「吃」→ `action chow --chow-index 1` (default)
- 「吃 2」→ `action chow --chow-index 2`
- 「過」→ `action pass`

### Match Progression

- Dealer order: East → South → West → North
- Dealer holds seat on win or draw; loses seat when another player wins
- Round wind advances with the dealer
- Match ends after North loses dealership

## Gotchas

- **Never read `.mahjong_state.json` directly** — it contains all hidden hands and the wall. Use the `view` command for public state only. Reading the state file would leak information and break fairness.
- **After pong/chow, the user must discard** — if `status` is `need_discard`, prompt for a discard before continuing.
- **Ting locks the hand** — once the user declares ting, they can only discard the tile they just drew. The engine enforces this but you should warn the user before they declare.
- **Don't recompute scoring** — trust the engine's `score` output. The scoring logic handles 30+ patterns with complex exclusion rules.
- **Wall ≤ 16 triggers draw** — the engine uses a 16-tile reserve. When `wall_remaining` hits 16, the hand ends in a draw.
- **Error handling** — if the engine returns an error (e.g., "你手上沒有這張牌"), show the error and ask the user to try again. Don't crash.

## Fairness Rules

- Use `view` for all public state. Never peek at hidden data.
- The engine's AI makes its own decisions via `structure_score` heuristic — don't override them.
- A declared-ting seat can only claim `hu` — no pong, chow, or kong.
- Claims happen on exposed tiles (discards, kong revelations). Hidden draws are not claimable.
- AI seats won't intentionally feed tiles (放槍) — the engine's heuristic avoids this naturally.

## Supported Files

- `scripts/mahjong_engine.js` — Main engine (CLI, state management, AI logic, game flow)
- `scripts/mahjong_scoring.js` — Scoring module (Pocket Funclub Taiwan 16-tile rules, 30+ patterns)
- `scripts/package.json` — ES module configuration
- `assets/board_template.md` — Display template with field mapping and prompt text
