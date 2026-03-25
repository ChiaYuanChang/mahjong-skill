# Mahjong Skill

A Taiwan Mahjong game skill for [Claude Code](https://github.com/anthropics/claude-code). Claude acts as dealer and referee, hosting a 4-player Taiwan 16-tile mahjong game (Pocket Funclub rules). The user plays as East; Claude AI controls South, West, and North.

> Inspired by this tweet: https://x.com/foxerine_/status/2034106804037423429

---

## Features

- Full Taiwan 16-tile mahjong rules (Pocket Funclub scoring)
- AI-controlled opponents for all three seats (South, West, North)
- All standard actions: draw, discard, pong, kong, chow, self-draw win, discard win
- 30+ scoring patterns (Pure One Suit, All Triplets, Heaven Win, All Honors, and more)
- Flower tile supplement mechanic
- Ready (Ting) declaration with Concealed Hand bonus
- Dealer streak tracking
- Full match event logging

---

## Requirements

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://github.com/anthropics/claude-code)

---

## Installation

1. Clone the repository:

   ```bash
   git clone <repo-url>
   cd mahjong-skill
   ```

2. Verify the engine works:

   ```bash
   cd skills/mahjong/scripts
   node mahjong_engine.js --help
   ```

3. Add `skills/mahjong/SKILL.md` as a custom skill in your Claude Code project, or open this folder as your Claude Code working directory.

   > See the [Claude Code documentation](https://github.com/anthropics/claude-code) for details on configuring custom skills.

---

## Starting a Game

Type any of the following in Claude Code to begin a match:

```
打麻將
我要打麻將
打個麻將
來打麻將
發個牌
```

Claude will deal the tiles and display the board automatically.

---

## How to Play

### Discarding a Tile

Type the tile you want to discard. Both Chinese names and shorthand codes are accepted:

| Suit | Example inputs |
|------|----------------|
| Characters (萬) | `1萬`, `三萬`, `1m` |
| Circles (筒) | `2筒`, `五筒`, `6p` |
| Bamboo (條) | `3條`, `七條`, `8s` |
| Winds | `東` / `南` / `西` / `北` |
| Dragons | `中` / `發` / `白` |

### Declaring Ready (Ting)

Discard a tile and declare ready at the same time (adds Concealed Hand bonus):

```
聽牌，打 7筒
打 3萬 聽牌
```

### Claims & Actions

After another player discards, you can respond:

| Action | Example input |
|--------|---------------|
| Win (discard) | `胡`, `胡牌`, `食胡` |
| Pong | `碰` |
| Kong | `槓` |
| Chow (left player only) | `吃` |
| Pass | `過`, `不要`, `pass` |

### Self-Draw Win

When you draw a winning tile:

```
自摸
```

---

## Scoring Patterns (Selected)

| Pattern | Tai |
|---------|-----|
| Heaven Win (天胡) | 24 |
| Earth Win (地胡) | 16 |
| Big Four Winds (大四喜) | 16 |
| All Honors (字一色) | 16 |
| Pure One Suit (清一色) | 8 |
| Small Four Winds (小四喜) | 8 |
| Big Three Dragons (大三元) | 8 |
| All Triplets (碰碰胡) | 4 |
| Ping Hu (平胡) | 2 |
| Concealed Hand (門清) | 1 |
| Self-Draw (自摸) | 1 |
| Kong Draw (槓上開花) | 1 |
| Last Tile Draw (海底撈月) | 1 |
| Ready (聽牌) | 1 |

---

## Project Structure

```
mahjong-skill/
└── skills/mahjong/
    ├── SKILL.md                  # Skill definition and game rules
    ├── scripts/
    │   ├── mahjong_engine.js     # Core game engine (dealing, state, AI)
    │   ├── mahjong_scoring.js    # Pattern recognition and scoring
    │   └── package.json          # ES Module config
    ├── assets/
    │   └── board_template.md     # Board display template
    └── logs/
        └── <match_id>/
            ├── match.json        # Match metadata
            ├── latest_public.json
            └── events.jsonl      # Match event log
```

---

## Technical Notes

- Game engine is written in Node.js (ES Modules), driven via CLI commands
- Match state is stored in `.mahjong_state.json` and written atomically after each command
- Uses the mulberry32 PRNG; pass `--seed <value>` to reproduce a specific game
- AI uses a heuristic `structure_score` function to simulate reasonable play
- The `view` command returns a public-only state snapshot (opponent hands are hidden) to ensure fairness

---

## License

MIT License
