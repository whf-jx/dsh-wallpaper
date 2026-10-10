# dsh-wallpaper · Local Wallpaper Plugin

[中文](./README.md) | English

Local **image / video wallpapers** for the [DeepSeek Harness](https://github.com/deepseek-ai) Web GUI: upload your own media, switch manually, rotate on a timer — all from the settings page, with changes taking effect immediately.

No online service is involved; your media never leaves this machine.

## ✨ Features

- **Image and video wallpapers** — images: `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp` `.avif`; video: `.mp4` `.webm` `.ogv` `.mov` `.m4v`, played muted and looping
- **Timed rotation** — 7 intervals (30 s / 1 min / 5 min / 30 min / 1 hour / 3 hours / 6 hours), independently switchable; the clock lives on the host, so **it keeps advancing with the page closed**
- **Shuffle** — rotate in order or pick at random
- **Manual control** — click any item, or step back / forward
- **Look controls** — wallpaper clarity, text scrim, background blur, fill mode (cover / contain / fill / tile)
- **Dark-theme text brightening** — while a wallpaper is showing in the dark theme, the three label tones are raised so conversation text stays readable
- **Persistent state** — the enable flag, interval and current item live in `$DSH_HOME/wallpaper/index.json`

## 📦 Installation

> This plugin is **not published to npm yet** — use method 1 or 2 below.

### Method 1: install with `dsh plugin` (recommended)

`dsh plugin` can consume a GitHub source directly:

```bash
dsh plugin --profile web add github:whf-jx/dsh-wallpaper
```

Then **restart** DSH once (plugin rows are discovered at startup) and reload the page.

### Method 2: mount manually (when `dsh plugin add` is unavailable)

```bash
# 1) clone the source into the plugin directory
git clone https://github.com/whf-jx/dsh-wallpaper.git ~/.dsh/plugins-src/dsh-wallpaper

# 2) link it into the web profile's node_modules
#    Windows:
mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-wallpaper" "%USERPROFILE%\.dsh\plugins-src\dsh-wallpaper"
#    macOS / Linux:
ln -s ~/.dsh/plugins-src/dsh-wallpaper ~/.dsh/profiles/web/node_modules/dsh-wallpaper
```

3) Append the insert entry to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: wallpaper
      name: dsh-wallpaper
```

4) Restart DSH.

> **Three ids must agree**: the patch's `id`, the insert entry's `name`, and the client
> bundle's `__ModuleLoader__.load({ id })`. The carrier serves the client bundle keyed by the
> entry name (the path prefix varies between DSH versions), so a mismatch 404s.
>
> This package has **zero runtime dependencies** — `pnpm install` is not needed, and the
> profile's `package.json` does not need an entry either, because module resolution goes
> through the `node_modules` directory itself.

## 🎛️ Usage

Open **Settings → Local Wallpaper**:

| Control | Description |
| --- | --- |
| Upload image / video | Multi-select; uploads appear in the list immediately |
| Enable wallpaper | Master switch; turning it off unmounts the whole backdrop (including video decoding, so the GPU is released) |
| Auto rotate | Separate switch; when off the current item is pinned, and the interval buttons stay visible but greyed out |
| Shuffle | Pick each next item at random |
| Rotation interval | 7 steps from 30 seconds to 6 hours |
| Wallpaper clarity | 5–100%; higher makes the art more vivid |
| Text scrim | 0–90%; lays a dark veil over the wallpaper so interface text stays legible |
| Background blur | 0–60 px; blurs the art so its detail stops competing with the text |
| Fill mode | cover / contain / fill / tile (video cannot tile and falls back to cover) |

**Suggested for the dark theme**: wallpaper clarity 15–20%, text scrim 60–70%, background blur 10–15 px — a balance of atmosphere and readability.

## 💾 Data location

Everything lives under `$DSH_HOME/wallpaper/` (default `~/.dsh/wallpaper/`):

```
$DSH_HOME/wallpaper/
  index.json          # the single source of truth: enable flag, interval, current item, item list
  images/             # raw media bytes
  trace.log           # optional; written only when DSH_WALLPAPER_TRACE is set
  client-probe.json   # optional; backdrop self-report snapshot, for troubleshooting
```

Deleting an item updates the index first and then removes the bytes on a best-effort basis; a failed byte removal does not affect consistency.

## 🔌 HTTP routes

All under `/api/dsh-wallpaper`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/state` | Full state plus the storage root |
| GET | `/revision` | Cheap poll: **returns only the `revision` counter**, which the page uses to decide whether to fetch the full state |
| GET | `/image/<id>` | Serves the media bytes; **video supports Range requests** |
| POST | `/upload` | `{ images: [{ name, dataUrl }] }`; a single request is capped at **96 MB** |
| POST | `/remove` | `{ id }` |
| POST | `/select` | `{ id \| null }` |
| POST | `/step` | `{ delta: 1 \| -1 }` |
| POST | `/config` | `{ patch: { enabled?, rotate?, intervalMs?, shuffle?, opacity?, dim?, blur?, fit? } }` |
| POST | `/probe` | Backdrop self-report from the client (troubleshooting; written to `client-probe.json`) |

## 🧩 Design notes

- **The backdrop is two stacked negative-z layers**: art at `z-index:-3` plus a scrim at `z-index:-2`. The art carries opacity and the scrim carries readability, so the two knobs never fight; while a wallpaper is visible, the opaque bases on `html`/`body`/`#root` are cleared and restored exactly on unmount.
- **Video must be served with Range**: a browser streams a `<video>` through byte-range requests and refuses to play — or to seek — a source that ignores them. Video therefore answers `206 + Content-Range`, `416` when unsatisfiable, and is streamed rather than read into memory whole.
- **`<video>` is a replaced element**: `top`/`right`/`bottom`/`left` alone will not stretch it; it needs an explicit `width/height:100%` before `object-fit` has a box to fit into.
- **The timer comes from the `timer` service**: `ctx.setInterval` does not exist — you must `inject: ['webServer', 'timer']` and call `ctx.timer.interval()`. A missing injection throws, and because that throw happens after the write and before the response, it surfaces as "the save worked but the UI reported a 400".
- **The `kind` field spans both halves**: the host's `publicState` must emit `kind` (`image`/`video`) and the client's `normalizeState` must map it into items; dropping it makes the renderer take the still-image branch forever.
- **Theme adaptation**: in the dark theme the `--dsw-alias-label-primary/secondary/tertiary` tokens are raised one step, only while a wallpaper is active; the light theme is left untouched.
- **The index is written atomically**: `index.json` is replaced through a sibling temp file plus `rename`, and writes are serialized. A file that fails to parse is renamed to `index.corrupt-<timestamp>.json` instead of being silently discarded — the index is the only record of which uploads exist, so losing it means losing the whole library.
- **Request bodies have a budget**: 1 MB for control routes and 96 MB for `/upload`. Past the budget the remaining bytes are drained but not retained, so memory stays bounded while the client still receives an explicit `413` (otherwise the carrier would answer a bare, uninformative 400).
- **Uploads proceed one file at a time**: the client reads a single file and uploads it before moving on, so peak memory is one file rather than the sum of everything selected.

## ⚠️ Known limitations

- Supports **web**-shaped DSH GUIs only (the client injects into `shell.overlay` and `settings.section`).
- Per-file ceiling **64 MB** (larger files are skipped with a message); per-request ceiling 96 MB.
- A video wallpaper keeps decoding on the GPU; **~8 Mbps is the recommended bitrate** (a 4-second 4K clip is often 50 Mbps or more, which is heavy for an always-on backdrop).
- "Tile" has no meaning for video and falls back to cover.
- No thumbnail generation: videos preview in the list through a `<video preload="metadata">` element (plays on hover).
- Deletion is a **two-step confirm** (the first click only arms that item; it disarms itself after 4 seconds) so a large file cannot be lost to a stray click.

## 📄 License

MIT
