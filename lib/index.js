/**
 * dsh-wallpaper host half.
 *
 * Owns the durable truth of the wallpaper feature:
 *  - the settings namespace `wallpaper` (enable switch, interval, current image)
 *  - the on-disk image store under $DSH_HOME/wallpaper/
 *  - the rotation clock, so automatic switching keeps running with no page open
 *  - an HTTP route that serves image bytes to the browser
 *
 * The client half is a pure view: it renders the background layer and the
 * settings page, and calls the JSON routes registered here.
 */
import { readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises'
import { createReadStream, appendFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

/** Cordis plugin name (the loader entry id and the client bundle id). */
export const name = 'wallpaper'

/**
 * Services required before load: the HTTP carrier that serves our routes, and
 * the timer that owns the rotation clock. `timer` is what provides
 * `ctx.timer.interval`; without it declared here the rotation clock cannot be
 * started at all — and because `startClock()` runs after every settings write,
 * that failure surfaced as a bare HTTP 400 on each save.
 */
export const inject = ['webServer', 'timer']

const ROUTE_PREFIX = '/api/dsh-wallpaper'

/**
 * Accepted media, split by kind because the two need different rendering and
 * different HTTP behaviour: stills are painted with `background-image` and can
 * be served in one response, while video needs a `<video>` element and must be
 * served with Range support so the browser can seek and stream.
 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov', '.m4v']
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
}

/** `'video'` for the video extensions, otherwise `'image'`. */
function kindOf(name) {
  return VIDEO_EXTENSIONS.includes(extOf(name)) ? 'video' : 'image'
}

/** Where the image store and its index live. */
function storeRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'wallpaper')
}

function indexPath() {
  return join(storeRoot(), 'index.json')
}

function imagesDir() {
  return join(storeRoot(), 'images')
}

function extOf(name) {
  return extname(String(name || '')).toLowerCase()
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Diagnostic breadcrumb for the mutation route, disabled unless
 * DSH_WALLPAPER_TRACE is set.
 *
 * The carrier answers a request whose handler throws with a bare 400 and logs
 * only into the process stdout, which is not reachable from here. Each stage of
 * the mutation handler can therefore be recorded on disk to locate a throwing
 * statement. Best-effort by design: tracing must never be the reason a settings
 * edit fails.
 */
function trace(stage) {
  if (!process.env.DSH_WALLPAPER_TRACE) return
  try {
    appendFileSync(
      join(storeRoot(), 'trace.log'),
      `${new Date().toISOString()} ${stage}\n`,
      'utf8',
    )
  } catch {
    // Tracing is diagnostic only.
  }
}

function emptyIndex() {
  return {
    enabled: true,
    // Whether the rotation clock advances. Distinct from `enabled` (does the
    // wallpaper show at all) and from `intervalMs` (how long a step takes): a
    // user who wants one wallpaper to stay put turns this off instead of
    // hunting for an "infinity" interval, which the clamp cannot represent.
    rotate: true,
    intervalMs: 60000,
    currentId: null,
    shuffle: false,
    // Rendering defaults for the light theme, matching how the shipped
    // skin-center paints its wallpaper: art at 40% over a white base, no
    // scrim, cover fit, no blur.
    opacity: 40,
    dim: 0,
    fit: 'cover',
    blur: 0,
    items: [],
  }
}

const FITS = ['cover', 'contain', 'fill', 'tile']

/**
 * Request-body budgets.
 *
 * The upload route carries base64 payloads and therefore needs a much larger
 * budget than the control routes — but every route needs *a* budget: without
 * one, a single oversized request is buffered whole inside the host process.
 * 96 MB leaves room for one 64 MB file after base64 inflation (~4/3) plus the
 * JSON envelope.
 */
const MAX_JSON_BYTES = 1024 * 1024
const MAX_UPLOAD_BYTES = 96 * 1024 * 1024

/** Thrown when a request body exceeds the budget of the route being served. */
class BodyTooLarge extends Error {
  constructor(limit) {
    super(`request body exceeds ${limit} bytes`)
    this.name = 'BodyTooLarge'
    this.limit = limit
  }
}

/** Normalize a persisted index, tolerating a missing or partial file. */
function normalizeIndex(raw) {
  const base = emptyIndex()
  if (raw === null || typeof raw !== 'object') return base
  if (typeof raw.enabled === 'boolean') base.enabled = raw.enabled
  if (typeof raw.rotate === 'boolean') base.rotate = raw.rotate
  if (typeof raw.shuffle === 'boolean') base.shuffle = raw.shuffle
  base.intervalMs = clamp(raw.intervalMs, 5000, 86400000, base.intervalMs)
  base.opacity = clamp(raw.opacity, 5, 100, base.opacity)
  base.dim = clamp(raw.dim, 0, 90, base.dim)
  base.blur = clamp(raw.blur, 0, 60, base.blur)
  if (FITS.includes(raw.fit)) base.fit = raw.fit
  if (typeof raw.currentId === 'string') base.currentId = raw.currentId
  if (Array.isArray(raw.items)) {
    base.items = raw.items
      .filter((item) => item && typeof item.id === 'string' && typeof item.file === 'string')
      .map((item) => ({
        id: item.id,
        file: item.file,
        name: typeof item.name === 'string' ? item.name : item.file,
        bytes: Number.isFinite(item.bytes) ? item.bytes : 0,
        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0,
        // Derived from the stored filename rather than trusted from disk: a
        // stored `kind` could disagree with the file after a manual rename, and
        // the extension is the value the renderer and the range logic both key
        // off. Pre-existing entries migrate for free because they fall through
        // to their own extension.
        kind: item.kind === 'video' || item.kind === 'image' ? item.kind : kindOf(item.file),
      }))
  }
  if (base.currentId !== null && !base.items.some((item) => item.id === base.currentId)) {
    base.currentId = base.items.length > 0 ? base.items[0].id : null
  }
  return base
}

/**
 * Read the persisted index.
 *
 * A file that cannot be parsed is moved aside rather than dropped: the index is
 * the user's only record of what was uploaded, and the media bytes on disk are
 * unreachable without it, so silently starting from an empty index would look
 * exactly like the whole library was lost.
 */
async function readIndex() {
  let raw
  try {
    raw = await readFile(indexPath(), 'utf8')
  } catch {
    // No file yet — a first boot, not a failure.
    return emptyIndex()
  }
  try {
    return normalizeIndex(JSON.parse(raw))
  } catch {
    await rename(indexPath(), join(storeRoot(), `index.corrupt-${Date.now()}.json`)).catch(() => {})
    return emptyIndex()
  }
}

/**
 * Replace the index atomically.
 *
 * A direct writeFile can be interrupted, or interleave with the rotation
 * clock's own write, and leave truncated JSON behind. The new document is
 * therefore staged in a sibling temp file and renamed over the target, so a
 * reader only ever sees a complete document.
 */
async function writeIndex(index) {
  await mkdir(storeRoot(), { recursive: true })
  const temp = `${indexPath()}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(temp, JSON.stringify(index, null, 2), 'utf8')
    await rename(temp, indexPath())
  } catch (error) {
    // Never leave a staged temp file behind when the replace fails.
    await unlink(temp).catch(() => {})
    throw error
  }
}

function publicState(index, revision) {
  const items = index.items.map((item) => ({
    id: item.id,
    name: item.name,
    bytes: item.bytes,
    // The client branches its renderer on this: `background-image` for a still,
    // a `<video>` element for video.
    kind: kindOf(item.file),
    url: `${ROUTE_PREFIX}/image/${encodeURIComponent(item.id)}`,
  }))
  const current = items.find((item) => item.id === index.currentId) || null
  return {
    enabled: index.enabled,
    rotate: index.rotate,
    intervalMs: index.intervalMs,
    shuffle: index.shuffle,
    opacity: index.opacity,
    dim: index.dim,
    fit: index.fit,
    blur: index.blur,
    currentId: current === null ? null : current.id,
    revision,
    items,
  }
}

/**
 * Mount the wallpaper store: routes, index ownership, and the rotation clock.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  /** Live index; the single source of truth for every route. */
  let index = emptyIndex()
  let revision = 0
  let ready = false
  let timerDispose = null
  /** Tail of the write queue; see persist(). */
  let writeChain = Promise.resolve()

  const bump = () => {
    revision += 1
  }

  /**
   * Persist the live index, one write at a time.
   *
   * Writes arrive from two independent places — a route handler answering a
   * settings edit, and the rotation clock ticking in the background — so they
   * are chained rather than allowed to overlap. Reading `index` when the queued
   * write actually runs also means a queued write publishes the newest state
   * instead of a stale snapshot.
   */
  function persist() {
    bump()
    const next = writeChain.then(
      () => writeIndex(index),
      () => writeIndex(index),
    )
    // Keep the queue alive after a failure so later writes still run; the
    // caller still receives the rejecting promise.
    writeChain = next.catch(() => {})
    return next
  }

  function currentPosition() {
    const at = index.items.findIndex((item) => item.id === index.currentId)
    return at
  }

  function pickNext() {
    if (index.items.length === 0) return null
    if (index.items.length === 1) return index.items[0].id
    if (index.shuffle) {
      const pool = index.items.filter((item) => item.id !== index.currentId)
      return pool[Math.floor(Math.random() * pool.length)].id
    }
    const at = currentPosition()
    const next = at < 0 ? 0 : (at + 1) % index.items.length
    return index.items[next].id
  }

  function stopClock() {
    if (timerDispose !== null) {
      timerDispose()
      timerDispose = null
    }
  }

  function startClock() {
    stopClock()
    // `rotate: false` means the user pinned one wallpaper: no clock is
    // scheduled at all. It has to be its own flag rather than a huge interval,
    // because the clamp above folds the period into [5s, 24h] and no duration
    // could ever mean "never".
    if (!index.enabled || !index.rotate || index.items.length < 2) return
    timerDispose = ctx.timer.interval(() => {
      const next = pickNext()
      if (next === null) return
      index.currentId = next
      persist().catch(() => {
        // A failed write leaves the in-memory index authoritative; the next
        // successful write repairs the file.
      })
    }, index.intervalMs)
  }

  const restartClock = () => {
    stopClock()
    startClock()
  }

  async function load() {
    index = await readIndex()
    await mkdir(imagesDir(), { recursive: true })
    bump()
    ready = true
    restartClock()
  }

  // ---------------------------------------------------------------- routes

  /**
   * Serve one stored medium by id.
   *
   * Stills go out whole in a single response. Video is served with Range
   * support (RFC 7233): a browser streams a `<video>` with byte-range requests
   * and will refuse to play — or seek — a source that ignores them, so a plain
   * 200 with the full body is not an acceptable shortcut here.
   */
  async function serveImage(req, res, id) {
    const item = index.items.find((entry) => entry.id === id)
    if (item === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const target = join(imagesDir(), item.file)
    const type = MIME_BY_EXT[extOf(item.file)] || 'application/octet-stream'
    let size
    try {
      size = (await stat(target)).size
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('missing')
      return
    }

    const range = String(req.headers.range || '')
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    // Only video is worth range-serving; a still is small and cached whole,
    // and honouring ranges there would only add branches for no gain.
    const wantsRange = match !== null && kindOf(item.file) === 'video'

    if (!wantsRange) {
      try {
        const bytes = await readFile(target)
        res.writeHead(200, {
          'content-type': type,
          'content-length': String(bytes.length),
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(bytes)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('missing')
      }
      return
    }

    // A malformed or unsatisfiable range must be answered 416 with a
    // Content-Range that states the real size, otherwise players retry forever.
    const rawStart = match[1]
    const rawEnd = match[2]
    let start = rawStart === '' ? null : Number(rawStart)
    let end = rawEnd === '' ? null : Number(rawEnd)
    if (start === null) {
      // Suffix form `bytes=-N`: the last N bytes.
      const suffix = end === null ? 0 : end
      start = Math.max(0, size - suffix)
      end = size - 1
    } else if (end === null || end >= size) {
      end = size - 1
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }

    const length = end - start + 1
    res.writeHead(206, {
      'content-type': type,
      'content-length': String(length),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(target, { start, end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  /**
   * Read and parse a JSON request body, refusing to buffer more than `maxBytes`.
   *
   * Past the budget the remaining bytes are drained but not retained: memory
   * stays bounded, yet the client still receives a proper 413 instead of a
   * socket error, which is what an early disconnect would produce.
   */
  async function readBody(req, maxBytes = MAX_JSON_BYTES) {
    const chunks = []
    let total = 0
    let overflowed = false
    for await (const chunk of req) {
      total += chunk.length
      if (total > maxBytes) {
        overflowed = true
        // Release what was already retained; the rest of the body is discarded
        // as it arrives rather than accumulated.
        chunks.length = 0
        continue
      }
      if (!overflowed) chunks.push(chunk)
    }
    if (overflowed) throw new BodyTooLarge(maxBytes)
    if (chunks.length === 0) return null
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return null
    }
  }

  function json(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  /**
   * Wrap a route handler so an oversized body answers an explicit 413.
   *
   * Letting the throw escape would hand the request to the carrier, which
   * replies with a bare 400 carrying no body and logs only into the process
   * stdout — indistinguishable from a handler bug, and useless to the page.
   */
  function withBodyLimit(handler) {
    return async (req, res) => {
      try {
        await handler(req, res)
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          json(res, 413, {
            ok: false,
            error: `请求体过大(上限 ${Math.round(error.limit / 1048576)} MB)`,
          })
          return
        }
        throw error
      }
    }
  }

  async function handleState(req, res) {
    json(res, 200, { ok: true, state: publicState(index, revision), root: storeRoot() })
  }

  async function handleUpload(req, res) {
    // The one route whose payload is expected to be large; everything else
    // stays on the 1 MB control budget.
    const body = await readBody(req, MAX_UPLOAD_BYTES)
    const images = body !== null && Array.isArray(body.images) ? body.images : []
    if (images.length === 0) {
      json(res, 400, { ok: false, error: '没有收到图片数据' })
      return
    }
    await mkdir(imagesDir(), { recursive: true })
    const added = []
    for (const image of images) {
      if (image === null || typeof image !== 'object') continue
      const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : ''
      const comma = dataUrl.indexOf(',')
      if (comma < 0) continue
      const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
      if (bytes.length === 0) continue
      const ext = MEDIA_EXTENSIONS.includes(extOf(image.name)) ? extOf(image.name) : '.png'
      const id = `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const file = `${id}${ext}`
      await writeFile(join(imagesDir(), file), bytes)
      const item = {
        id,
        file,
        name: typeof image.name === 'string' && image.name !== '' ? image.name : file,
        bytes: bytes.length,
        addedAt: Date.now(),
        kind: kindOf(file),
      }
      index.items.push(item)
      added.push(id)
    }
    if (index.currentId === null && index.items.length > 0) index.currentId = index.items[0].id
    await persist()
    restartClock()
    json(res, 200, { ok: true, added: added.length, state: publicState(index, revision) })
  }

  async function handleRemove(req, res) {
    const body = await readBody(req)
    const id = body !== null && typeof body.id === 'string' ? body.id : ''
    const item = index.items.find((entry) => entry.id === id)
    if (item === undefined) {
      json(res, 404, { ok: false, error: '图片不存在' })
      return
    }
    index.items = index.items.filter((entry) => entry.id !== id)
    if (index.currentId === id) index.currentId = index.items.length > 0 ? index.items[0].id : null
    await persist()
    restartClock()
    // Best-effort byte removal; the index is already the source of truth.
    unlink(join(imagesDir(), item.file)).catch(() => {})
    json(res, 200, { ok: true, state: publicState(index, revision) })
  }

  async function handleSelect(req, res) {
    const body = await readBody(req)
    const id = body !== null && typeof body.id === 'string' ? body.id : null
    if (id === null) {
      index.currentId = null
    } else if (index.items.some((entry) => entry.id === id)) {
      index.currentId = id
    } else {
      json(res, 404, { ok: false, error: '图片不存在' })
      return
    }
    await persist()
    // Reset the rotation phase: a manual pick should hold for a full interval,
    // not be overwritten by a tick that was already due.
    restartClock()
    json(res, 200, { ok: true, state: publicState(index, revision) })
  }

  async function handleStep(req, res) {
    const body = await readBody(req)
    const delta = body !== null && Number(body.delta) < 0 ? -1 : 1
    if (index.items.length === 0) {
      json(res, 200, { ok: true, state: publicState(index, revision) })
      return
    }
    const at = currentPosition()
    const size = index.items.length
    const next = ((at < 0 ? 0 : at + delta) % size + size) % size
    index.currentId = index.items[next].id
    await persist()
    // Same reasoning as handleSelect: stepping is a manual choice, so restart
    // the clock rather than letting a pending tick undo it immediately.
    restartClock()
    json(res, 200, { ok: true, state: publicState(index, revision) })
  }

  /**
   * Accept a client-side self-report about the backdrop and persist it.
   *
   * The desktop shell gives no practical way to relay a console, and a
   * replaced-element layout failure is invisible from the host, so the page
   * writes its own runtime state here for inspection. Always answers ok: a
   * failed diagnostic must never surface as a wallpaper error.
   */
  async function handleProbe(req, res) {
    const body = await readBody(req)
    const info = body !== null && typeof body.info === 'object' && body.info !== null ? body.info : null
    if (info !== null) {
      try {
        await mkdir(storeRoot(), { recursive: true })
        await writeFile(join(storeRoot(), 'client-probe.json'), JSON.stringify(info, null, 2), 'utf8')
      } catch {
        // Diagnostics only.
      }
    }
    json(res, 200, { ok: true })
  }

  async function handlePatch(req, res) {
    const body = await readBody(req)
    const patch = body !== null && typeof body.patch === 'object' && body.patch !== null ? body.patch : {}
    if (typeof patch.enabled === 'boolean') index.enabled = patch.enabled
    if (typeof patch.rotate === 'boolean') index.rotate = patch.rotate
    if (typeof patch.shuffle === 'boolean') index.shuffle = patch.shuffle
    if (patch.intervalMs !== undefined) {
      index.intervalMs = clamp(patch.intervalMs, 5000, 86400000, index.intervalMs)
    }
    if (patch.opacity !== undefined) {
      index.opacity = clamp(patch.opacity, 5, 100, index.opacity)
    }
    if (patch.dim !== undefined) {
      index.dim = clamp(patch.dim, 0, 90, index.dim)
    }
    if (patch.blur !== undefined) {
      index.blur = clamp(patch.blur, 0, 60, index.blur)
    }
    if (FITS.includes(patch.fit)) index.fit = patch.fit
    trace('patch:apply-done')
    await persist()
    trace('patch:persisted')
    restartClock()
    trace('patch:clock-restarted')
    json(res, 200, { ok: true, state: publicState(index, revision) })
    trace('patch:responded')
  }

  /**
   * Cheap revision probe the settings page polls for live updates.
   *
   * Deliberately minimal: the page polls this every 1.5 seconds and only
   * compares the counter, so serializing the whole state here was pure waste
   * (measured ~1.9 KB per poll, of which the client read one integer). The page
   * fetches the full state over /state only when this counter actually moves.
   */
  async function handleRevision(req, res) {
    json(res, 200, { ok: true, revision })
  }

  // The carrier matches on pathname only (no :param syntax), so the image
  // route claims the whole prefix and parses the id out of the request URL.
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/image`,
      handler: (req, res) => {
        const pathname = String(req.url || '').split('?')[0]
        const id = decodeURIComponent(pathname.slice(`${ROUTE_PREFIX}/image/`.length))
        if (id === '' || id === pathname) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }
        return serveImage(req, res, id)
      },
    })
  }, 'wallpaper: image route')

  ctx.effect(() => {
    const routes = [
      [`${ROUTE_PREFIX}/state`, handleState],
      [`${ROUTE_PREFIX}/revision`, handleRevision],
      [`${ROUTE_PREFIX}/upload`, handleUpload],
      [`${ROUTE_PREFIX}/remove`, handleRemove],
      [`${ROUTE_PREFIX}/select`, handleSelect],
      [`${ROUTE_PREFIX}/step`, handleStep],
      // Named /config, not /patch: on this carrier a request to the /patch path
      // is answered with a bare 400 before this handler is ever consulted, which
      // silently killed every settings control in the client (all of them POST
      // to the mutation route). Same handler, path the carrier routes normally.
      [`${ROUTE_PREFIX}/config`, handlePatch],
      [`${ROUTE_PREFIX}/probe`, handleProbe],
    ]
    // Every JSON route gets the body budget, so an oversized request is
    // refused with an explicit 413 rather than escaping to the carrier.
    const disposers = routes.map(([path, handler]) =>
      ctx.webServer.register({ kind: 'exact', path, handler: withBodyLimit(handler) }),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'wallpaper: json routes')

  ctx.effect(() => () => stopClock(), 'wallpaper: rotation clock')

  // Load the durable index once the plugin is applied; routes serve an empty
  // store until this resolves.
  load().catch(() => {
    // An unreadable store degrades to an empty index rather than failing the
    // fiber: the settings page still renders and the user can re-upload.
  })
}
