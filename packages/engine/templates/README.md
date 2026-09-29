# Templates

## spike-report.template.html

A standalone HTML report for a flag-removal spike. Adapted from Anthropic's
`11-status-report.html` in `anthropics/html-effectiveness`, so it keeps that
palette and type system: ivory ground, serif display, mono for data. Unlike the
original it carries a full dark theme, declared token-level across the bare
`:root`, `prefers-color-scheme` and `[data-theme]` so it holds in all three
viewer states.

No build step, no dependencies, no network fonts. Fill the tokens and open it.

### Tokens

Identity: `TITLE` `STAGE_PILL` `TICKET` `FLAG` `REPO` `COMMIT` `RUN_ID` `DATE`

Summary band, four tiles: `TILE_n_NUM` `TILE_n_CAP` `TILE_n_FOOT` for n in 1..4.
Add `class="tile flag"` for the number that needs attention and
`class="tile good"` for a settled one.

Store-derived: `AXIS_ROWS` `SCALE_NOTE` `CHECKS`

Narrative, owned by the synthesist: `DATA_HEADING` `DATA_SECTION`
`FINDINGS_INTRO` `FINDINGS` `NOT_COVERED` `FOOTER_PATHS`

### Rules that make it honest

The report is a claim about coverage, so three sections are not optional:

1. **The decisive row.** Whatever single number settles the migration question
   gets `class="decisive"` on its table row. In PURCO-3252 that was
   "party-owned account, party column empty", zero in both tenants.
2. **`NOT_COVERED` is mandatory.** A coverage report without its own blind spots
   is marketing. Name what the census cannot see: remote flag state, dynamic
   references, the hop limit, how many clusters were actually ground-truthed.
3. **`CHECKS` distinguishes proved from pending.** Use `class="check pending"`
   for anything not yet built or run, so nobody reads intent as evidence.

### Filling it

`AXIS_ROWS` and `CHECKS` come from the store, so compute them rather than typing
them. One `.axis-row` per axis, bar width as a percentage of the largest axis
count, and `SCALE_NOTE` must state what full width equals — a bar chart whose
scale is unstated is decoration.

Everything else the synthesist writes, citing a file and a line per claim.
