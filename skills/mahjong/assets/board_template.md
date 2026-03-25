# Board Display Template

Use this exact layout every time you show the game board to the user. Present all text in Traditional Chinese.

## Standard Board View

```
══════════════════════════════════════════════════════════════════
  🀄 台灣麻將 ── 第 {hand_index} 局 │ 圈風：{round_wind} │ 莊家：{dealer}(你) │ 剩餘牌山：{wall_remaining} 張
══════════════════════════════════════════════════════════════════
【牌桌局勢】
  [{seat}] {relation} │ 手牌: {count}張 │ 亮: {melds_or_無}       │ 海: {discards}
  [{seat}] {relation} │ 手牌: {count}張 │ 亮: {melds_or_無}       │ 海: {discards}
  [{seat}] {relation} │ 手牌: {count}張 │ 亮: {melds_or_無}       │ 海: {discards}
──────────────────────────────────────────────────────────────────
【你的狀態 ({seat_wind}家)】
  花牌：{flowers_or_無}
  亮牌：{melds_or_無}
  海底：{discards_or_無}

  ╭── 手牌 ──────────────────────────────╮  ╭── 進牌 ──╮
  │ 萬：{wan_tiles}                      │  │          │
  │ 筒：{pin_tiles}                      │  │  {draw}  │
  │ 條：{sou_tiles}                      │  │          │
  │ 字：{honor_tiles}                    │  ╰──────────╯
  ╰──────────────────────────────────────╯
══════════════════════════════════════════════════════════════════
  ⚡ {hint_line}
  ❯ {prompt_line}
```

## Field Mapping

| Placeholder      | Source from JSON output                                      |
|------------------|--------------------------------------------------------------|
| `hand_index`     | `hand_index`                                                 |
| `round_wind`     | `round_wind` → 東/南/西/北                                    |
| `dealer`         | `dealer` → 東家/南家/西家/北家                                 |
| `wall_remaining` | `wall_remaining`                                             |
| `seat`           | 北家/西家/南家 (the three opponents)                          |
| `relation`       | 上家/對家/下家 (relative to user = East)                      |
| `count`          | Opponent hand tile count (from `visible_melds` calculation)  |
| `melds`          | `visible_melds[seat]` → e.g. `[碰 8條←南]` `[吃 4-5-6萬←北]` |
| `discards`       | `visible_discards[seat]` joined by spaces                    |
| `flowers`        | `your_flowers` joined by spaces, or 「無」                    |
| `wan_tiles`      | Tiles from `your_hand` ending in 萬, numbers only            |
| `pin_tiles`      | Tiles from `your_hand` ending in 筒, numbers only            |
| `sou_tiles`      | Tiles from `your_hand` ending in 條, numbers only            |
| `honor_tiles`    | Tiles from `your_hand` that are 東/南/西/北/中/發/白          |
| `draw`           | `last_draw.tile` (the tile just drawn), blank if N/A         |
| `hint_line`      | Contextual hint (see below)                                  |
| `prompt_line`    | Action prompt (see below)                                    |

## Relation Mapping (User = East)

| Seat  | Chinese | Relation |
|-------|---------|----------|
| South | 南家    | 下家     |
| West  | 西家    | 對家     |
| North | 北家    | 上家     |

## Opponent Display Order

Always list opponents in this order: North (上家) → West (對家) → South (下家).

## Suit Grouping in Hand

Group the user's hand tiles by suit and show only the rank numbers within each group. If a group is empty, omit that line entirely. Examples:

- `萬：1 3 7` means the user holds 1萬, 3萬, 7萬
- `字：南 南 西 西` uses the Chinese character for each honor tile

## Draw Tile Box

- Show the draw tile box only when `last_draw` is present (the user just drew a tile).
- If no draw happened this turn (e.g., after a pong/chow), omit the draw box.

## Declared Ting Marker

- If a seat has declared ready (ting), append `[聽牌]` after their seat label.
- Example: `[南家][聽牌] 下家 │ ...`

## Wall Running Low

- When `wall_remaining` ≤ 16, add 「⚠ 即將流局」 to the hint line.

## Hint & Prompt Lines by Status

### `user_discard` (your turn to discard)

- Hint: List available special actions from `available_actions`:
  - If `ting` available: 「可聽牌的打法：{tiles}」
  - If `hu` available: 「可以自摸！」
  - Otherwise: 「無特殊行動可執行。」
- Prompt: 「輪到你出牌。請輸入牌碼 (如: 3萬, 發) 或 指令 (聽, 胡):」

### `user_draw` (you just drew a tile)

- Show the drawn tile in the draw box.
- If flowers were revealed during draw, note: 「補花：{flower_names}」
- Then transition to `user_discard` prompt.

### `user_response` (a tile is claimable)

- Hint: 「{source_seat}打出了【{tile}】」
- Prompt: List all available actions from `pending.options`:
  ```
  你可以：
    • 胡 → 輸入「胡」
    • 碰 → 輸入「碰」
    • 槓 → 輸入「槓」
    • 吃 {tiles} → 輸入「吃」或「吃 N」
    • 不要 → 輸入「過」
  ```

### `need_discard` (after pong/chow, you must discard)

- Same as `user_discard`, but hint adds: 「你{action}了 {tile}，請出牌。」

### `ended` (hand is over)

```
══════════════════════════════════════════════════════════════════
  本局結束！

  {log_content}

  {winner} 胡牌！ 贏法：{type}  胡的牌：{tile_name}
  台數：{total_tai} 台
  計算明細：
    {breakdown items: name + tai}
══════════════════════════════════════════════════════════════════
```

- If no winner: show 「流局」
- Ask: 「繼續下一局？還是結束？」

### `match_complete` (full match is over)

- Show a final summary and thank the user.

## Log Messages

Always display every entry from the `log` array before showing the board. These describe what happened since the user's last action (AI draws, discards, claims, ting declarations). Format each log entry on its own line, prefixed with `  │ `.

Example:
```
  │ 南家摸牌。
  │ 南家打出 3萬。
  │ 西家摸牌，補花 春，補進 7條。
  │ 西家打出 北風。
```
