# GlowApp

An installable habit, exercise and mood tracker. Formerly called Hábitos;
existing browser data is migrated automatically on first load. No build step, no accounts, no
backend — plain HTML, CSS and JavaScript that works offline once loaded.

## Running it

A service worker needs a real origin, so open it over HTTP rather than by
double-clicking the file:

```sh
npx --yes serve .        # then open http://localhost:3000/habits/
# or any static server, e.g.  python -m http.server
```

Opening `index.html` straight from the filesystem still works — the app itself
runs fine — but the service worker will not register, so there is no offline
support and no install prompt.

To install: open it in Chrome/Edge and use **Ajustes → Instalar app** (the button
appears once the browser offers the prompt). On iPhone, use Share → *Add to Home
Screen*.

## What it tracks

- **Yes/no habits** — check them off; streaks and a completion ring.
- **Habits with a target** — 8 glasses of water, 30 minutes of exercise, 20
  pages. A stepper and a progress bar against the daily goal.
- **Flexible schedules** — every day, specific weekdays, or *X times per week*.
  Streaks respect the schedule: a day the habit was not due never breaks one,
  and weekly-quota habits are counted in whole weeks.
- **Mood** — a 1–5 daily rating with optional energy level and a note, charted
  over time and cross-referenced against habit completion.

## Layout and size

The Today view has four layouts — Comfortable, Compact, Grid and Focus — and
three sizes, both under **Ajustes → Apariencia**. Size is the replacement for
pinch-zoom, which is deliberately disabled: every text size is in `rem` and the
layout paddings with them, so changing the root size rescales the interface in
one step while tap targets stay pinned in pixels.

## Language and theme

Both are switchable at runtime — the toggles in the app bar, or Ajustes. The
interface ships complete in Spanish and English (`i18n.js` holds every string;
the two tables are kept at full key parity). The theme follows the system by
default and can be pinned to light or dark.

## Your data

Everything lives in one `localStorage` record (`habitos.v1`) in the browser that
runs the app. It never leaves the device: there is no server to send it to.

That also means clearing site data erases it, and nothing syncs between your
phone and your laptop. **Ajustes → Exportar JSON** writes a full backup, and
*Importar JSON* restores one — the same file moves your history to another
device.

## Files

| File | What it holds |
|------|---------------|
| `index.html` | Markup for all four views, the habit editor dialog, icon sprite |
| `styles.css` | Design tokens for both themes, layout, components |
| `app.js` | State, storage, scheduling and streak logic, rendering, wiring |
| `charts.js` | Hand-rolled SVG charts (line, bars, grouped bars, heatmap) |
| `i18n.js` | Spanish and English string tables |
| `sw.js` | Service worker: precached shell, offline fallback |
| `icons/` | Generated PNG app icons, including a maskable one |

There are no dependencies and nothing is loaded from a CDN, which is what lets
the whole thing run from the cache with the network off.

## Notes for changing it

- Chart colours come from a colour-vision-safe categorical palette defined as
  CSS custom properties (`--s1`…`--s8`) with separate, individually chosen steps
  for light and dark. Change them in `styles.css` in both blocks, not one.
- Charts draw at the container's pixel width so label sizes are true; they
  redraw on resize.
- After editing any shell file, bump `CACHE` in `sw.js` if you want existing
  installs to drop the old copies immediately. Assets use
  stale-while-revalidate, so a change otherwise lands on the second load.
