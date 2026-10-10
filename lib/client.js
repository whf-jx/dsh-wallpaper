window.__ModuleLoader__.load({
  // Must equal the loader entry name (the package name): the carrier serves
  // this bundle as /plugins/<entryName>/client.js and boots it by that id.
  id: 'dsh-wallpaper',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    const API = '/api/dsh-wallpaper'
    const SECTION_ID = 'wallpaper'
    const OVERLAY_ID = 'wallpaper-backdrop'
    const POLL_MS = 1500
    /**
     * Per-file upload ceiling. A base64 payload is ~4/3 of the file size and the
     * host caps the whole request body at 96 MB, so this leaves headroom for the
     * JSON envelope. Rejected client-side so the user gets a clear message
     * instead of a failed request after a long upload.
     */
    const MAX_UPLOAD_FILE_BYTES = 64 * 1024 * 1024

    exports.name = 'wallpaper'
    exports.inject = ['slots']

    const CSS = [
      '.wp-page{display:flex;flex-direction:column;gap:16px;padding:4px 2px 32px}',
      '.wp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1)}',
      '.wp-head{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.wp-sub{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.wp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;flex-wrap:wrap}',
      '.wp-label{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.wp-range{width:170px;accent-color:var(--dsw-alias-brand-primary)}',
      '.wp-val{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:38px;text-align:right}',
      '.wp-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;line-height:1.4}',
      '.wp-btn:hover:not(:disabled):not(.on){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      // The selected state is a FILLED state whose fill
      // (--dsw-alias-brand-primary) is near-white in BOTH themes: bluish-1000
      // in light, bluish-50 = rgb(249,250,251) in dark. The ink on top must
      // therefore be a fixed DARK colour that never flips with the theme, so
      // neither theme token fits: label-primary-foreground resolves to
      // bluish-00 (dark) in light but bluish-1000 = rgb(15,17,21) (also dark)
      // in dark, which is why the label rendered dark-on-white in the desktop
      // dark theme, and label-primary-inverted is bluish-800, a mid grey, in
      // dark. Both were wrong for a near-white fill. A literal dark value is
      // the only choice that stays readable in both.
      '.wp-btn.on,.wp-seg button.on{background:var(--dsw-alias-brand-primary) !important;color:#1a1a1a !important}',
      // Hover keeps the fill and the ink identical on purpose: the fill has to
      // stay light, so darkening the ink on hover would sink the label into
      // the background. !important also wins over the app's runtime-injected
      // stylesheets, which load after this one.
      '.wp-btn.on:hover:not(:disabled),.wp-seg button.on:hover{background:var(--dsw-alias-brand-primary) !important;color:#1a1a1a !important}',
      '@supports not (color:var(--dsw-alias-brand-primary)){.wp-btn.on,.wp-seg button.on,.wp-btn.on:hover:not(:disabled),.wp-seg button.on:hover{background:#f9fafb;color:#1a1a1a}}',
      '.wp-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.wp-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}',
      '.wp-seg button{border:none;background:transparent;color:var(--dsw-alias-label-primary);padding:6px 12px;font-size:13px;cursor:pointer}',
      '.wp-seg button+button{border-left:1px solid var(--dsw-alias-border-l1)}',
      '.wp-seg button:hover:not(.on){background:var(--dsw-alias-bg-layer-2)}',
      '.wp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:12px}',
      '.wp-tile{position:relative;border:2px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;cursor:pointer;background:var(--dsw-alias-bg-layer-2)}',
      '.wp-tile.on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.wp-thumb{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}',
      '.wp-tag{position:absolute;left:6px;top:6px;font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff}',
      '.wp-del{position:absolute;right:6px;top:6px;font-size:11px;padding:2px 7px;border-radius:6px;border:none;cursor:pointer;background:rgba(0,0,0,.65);color:#fff}',
      // Armed state must be unmistakable: this click actually deletes.
      '.wp-del.armed{background:var(--dsw-alias-state-error-primary);font-weight:600}',
      '.wp-name{font-size:11px;color:var(--dsw-alias-label-secondary);padding:5px 6px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wp-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:26px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:12px}',
      '.wp-err{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '.wp-ok{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary)}',
      // Two stacked fixed layers, mirroring how the shipped skin-center paints
      // its wallpaper: the art at z-index -3 and a scrim above it at -2. The
      // art carries the opacity and the scrim carries readability, so the two
      // are independent knobs instead of one fighting the other.
      '.wp-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:-3;pointer-events:none;overflow:hidden;background-repeat:no-repeat;background-position:center center;will-change:transform}',
      // A <video> is a replaced element: unlike the <div> background layer it
      // does NOT stretch to fill a box defined only by top/right/bottom/left.
      // It lays out at its intrinsic size instead (3830x1900 for a typical
      // wallpaper clip), so the offsets alone leave it overflowing the viewport
      // with only a corner visible behind the shell. It needs an explicit size
      // of 100%/100% for object-fit to have a box to fit into.
      '.wp-backdrop[data-wp-video]{width:100%;height:100%;display:block}',
      '.wp-scrim{position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none}',
      // The negative-z art only shows when the opaque shell base is cleared.
      // html keeps a theme-appropriate solid colour (so translucency fades
      // toward white in light mode and black in dark mode, exactly as the
      // skin-center backdrop does), while body and #root go transparent.
      'html[data-dsh-wallpaper-active]{background-color:#fff !important;background-image:none !important}',
      'html[data-dsh-wallpaper-active]:has(body[data-ds-dark-theme]){background-color:#000 !important}',
      'body[data-dsh-wallpaper-active],html[data-dsh-wallpaper-active] body,body[data-dsh-wallpaper-active][data-ds-dark-theme]{background-color:transparent !important;background-image:none !important}',
      '[id="root"]{background:transparent}',
      'html[data-dsh-wallpaper-active] [id="root"]{background-color:transparent !important;background-image:none !important}',
      // Text legibility over the art, dark theme only. The art sits behind the
      // conversation text, which costs the contrast the theme was designed for,
      // so the label ramp is nudged up one step while a wallpaper is showing:
      // primary to pure white, secondary and tertiary one bluish step brighter
      // (300->200, 400->300). The ramp keeps its spacing, so the visual
      // hierarchy between a message, a timestamp and a comment survives.
      // Scoped to body[data-ds-dark-theme] on purpose: the same overrides on
      // the light theme would push dark ink toward white and erase it.
      'body[data-ds-dark-theme][data-dsh-wallpaper-active]{--dsw-alias-label-primary:#fff}',
      'body[data-ds-dark-theme][data-dsh-wallpaper-active]{--dsw-alias-label-secondary:var(--dsw-static-neutral-bluish-200)}',
      'body[data-ds-dark-theme][data-dsh-wallpaper-active]{--dsw-alias-label-tertiary:var(--dsw-static-neutral-bluish-300)}',
    ].join('\n')

    const PRESET_INTERVALS = [
      [30000, '30 秒'],
      [60000, '1 分钟'],
      [300000, '5 分钟'],
      [1800000, '30 分钟'],
      [3600000, '1 小时'],
      [10800000, '3 小时'],
      [21600000, '6 小时'],
    ]

    function intervalLabel(ms) {
      if (ms % 3600000 === 0) return ms / 3600000 + ' 小时'
      if (ms % 60000 === 0) return ms / 60000 + ' 分钟'
      return Math.round(ms / 1000) + ' 秒'
    }

    /** Coerce a possibly-absent numeric setting to a safe fallback. */
    function pct(value, fallback) {
      return Number.isFinite(value) ? value : fallback
    }

    function humanSize(bytes) {
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
      if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
      return bytes + ' B'
    }

    function emptyState() {
      return {
        enabled: true,
        // Whether the rotation clock advances at all. Kept separate from
        // `enabled` (does the wallpaper show) and from `intervalMs` (how long
        // each step takes) so "hold this one wallpaper" needs no fake interval.
        rotate: true,
        intervalMs: 60000,
        shuffle: false,
        // Light-theme defaults, matching how the shipped skin-center renders
        // its wallpaper: the art shows at 40% over a white base with no scrim.
        opacity: 40,
        dim: 0,
        fit: 'cover',
        blur: 0,
        currentId: null,
        revision: 0,
        items: [],
      }
    }

    function normalizeState(raw) {
      if (raw === null || typeof raw !== 'object') return emptyState()
      return {
        enabled: raw.enabled !== false,
        rotate: raw.rotate !== false,
        intervalMs: Number.isFinite(raw.intervalMs) ? raw.intervalMs : 60000,
        shuffle: raw.shuffle === true,
        opacity: Number.isFinite(raw.opacity) ? raw.opacity : 40,
        dim: Number.isFinite(raw.dim) ? raw.dim : 0,
        fit: typeof raw.fit === 'string' ? raw.fit : 'cover',
        blur: Number.isFinite(raw.blur) ? raw.blur : 0,
        currentId: typeof raw.currentId === 'string' ? raw.currentId : null,
        revision: Number.isFinite(raw.revision) ? raw.revision : 0,
        items: Array.isArray(raw.items)
          ? raw.items.map((item) => ({
              id: String(item.id),
              name: String(item.name),
              url: String(item.url),
              bytes: Number.isFinite(item.bytes) ? item.bytes : 0,
              // Must survive normalization: the backdrop and the tile list both
              // branch on it, and dropping it here silently rendered every video
              // through the still-image path. Derived from the URL when the host
              // half is too old to send it, so the two halves cannot disagree.
              kind:
                item.kind === 'video' || item.kind === 'image'
                  ? item.kind
                  : /\.(mp4|webm|ogv|mov|m4v)$/i.test(String(item.url))
                    ? 'video'
                    : 'image',
            }))
          : [],
      }
    }

    /** One shared snapshot so the settings page and the backdrop never diverge. */
    const store = {
      state: emptyState(),
      root: null,
      busy: false,
      error: null,
      notice: null,
    }
    const watchers = new Set()

    function emit() {
      for (const watcher of Array.from(watchers)) {
        try {
          watcher()
        } catch {
          // One broken subscriber must not stop the rest.
        }
      }
    }

    function useStore() {
      const pair = React.useState(0)
      const force = pair[1]
      React.useEffect(() => {
        const watcher = () => force((value) => value + 1)
        watchers.add(watcher)
        return () => {
          watchers.delete(watcher)
        }
      }, [])
      return store
    }

    async function request(path, body) {
      const init = { cache: 'no-store', method: body === undefined ? 'GET' : 'POST' }
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const response = await fetch(API + path, init)
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (payload === null || payload.ok !== true) {
        throw new Error((payload && payload.error) || '请求失败 (HTTP ' + response.status + ')')
      }
      return payload
    }

    function adopt(payload) {
      if (payload !== null && payload.state !== undefined) store.state = normalizeState(payload.state)
      if (payload !== null && typeof payload.root === 'string') store.root = payload.root
    }

    async function refresh() {
      try {
        adopt(await request('/state'))
        store.error = null
      } catch (error) {
        store.error = String((error && error.message) || error)
      }
      emit()
    }

    async function mutate(path, body, notice) {
      store.busy = true
      store.notice = null
      emit()
      try {
        adopt(await request(path, body || {}))
        store.error = null
        store.notice = notice || null
      } catch (error) {
        store.error = String((error && error.message) || error)
      }
      store.busy = false
      emit()
    }

    function currentItem() {
      return store.state.items.filter((item) => item.id === store.state.currentId)[0] || null
    }

    /**
     * Report the backdrop's real runtime state to the host, which persists it
     * next to the wallpaper store.
     *
     * This exists because the layer can fail in ways that are invisible from
     * outside the page (a replaced element collapsing to zero size, an autoplay
     * rejection, a decode error) and the desktop shell offers no convenient way
     * to relay console output. Failures are swallowed: diagnostics must never
     * be the reason the wallpaper stops rendering.
     */
    function reportBackdrop(element, kind) {
      try {
        const info = { kind: kind, at: new Date().toISOString() }
        if (element === null || element === undefined) {
          info.missing = true
        } else {
          const rect = element.getBoundingClientRect()
          const style = window.getComputedStyle(element)
          info.tag = element.tagName
          info.marker = element.getAttribute('data-wp-video') !== null
          info.rect = Math.round(rect.width) + 'x' + Math.round(rect.height)
          info.display = style.display
          info.opacity = style.opacity
          info.zIndex = style.zIndex
          info.position = style.position
          info.objectFit = style.objectFit
          info.src = String(element.currentSrc || element.src || '').slice(0, 160)
          if (kind === 'video') {
            info.readyState = element.readyState
            info.networkState = element.networkState
            info.paused = element.paused
            info.muted = element.muted
            info.loop = element.loop
            info.videoWidth = element.videoWidth
            info.videoHeight = element.videoHeight
            info.error = element.error === null ? null : String(element.error.code) + ':' + String(element.error.message)
          }
        }
        const probe = document.createElement('video')
        info.canMp4 = probe.canPlayType('video/mp4')
        info.canH264 = probe.canPlayType('video/mp4; codecs="avc1.42E01E"')
        request('/probe', { info: info }).catch(() => {})
      } catch {
        // Diagnostics only.
      }
    }

    function readAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取文件失败:' + file.name))
        reader.readAsDataURL(file)
      })
    }

    function Backdrop() {
      const snapshot = useStore()
      const state = snapshot.state
      const item = currentItem()
      const visible = state.enabled && item !== null

      // A negative-z backdrop paints behind the shell's static panels, so the
      // opaque base background on html/body/#root must be cleared while art is
      // mounted or the wallpaper would be invisible. Mirrors the shipped
      // skin-center background layer, including the exact restore on unmount.
      React.useEffect(() => {
        if (!visible) return undefined
        const html = document.documentElement
        const body = document.body
        const ATTRIBUTE = 'data-dsh-wallpaper-active'
        const bodyBackground = body.style.getPropertyValue('background-color')
        html.setAttribute(ATTRIBUTE, '')
        body.setAttribute(ATTRIBUTE, '')
        body.style.setProperty('background-color', 'transparent')
        return () => {
          html.removeAttribute(ATTRIBUTE)
          body.removeAttribute(ATTRIBUTE)
          if (bodyBackground === '') body.style.removeProperty('background-color')
          else body.style.setProperty('background-color', bodyBackground)
        }
      }, [visible])

      // Two stacked layers, as the shipped skin-center paints its wallpaper:
      // the art carries the opacity, and a separate scrim above it carries the
      // dim that keeps text readable. Keeping them separate means raising the
      // art's visibility never has to fight the readability control.
      // Guard every numeric field here as well as in normalizeState: a host
      // half older than this bundle omits newer fields, and an undefined would
      // turn the scrim colour into rgba(0,0,0,NaN) and silently drop the rule.
      const opacity = pct(state.opacity, 40)
      const dim = pct(state.dim, 0)
      const blur = pct(state.blur, 0)
      const fit = typeof state.fit === 'string' ? state.fit : 'cover'

      // Automatic self-report, so a rendering failure can be diagnosed from the
      // host side without asking the user to read a console. It runs after the
      // element is committed and again once the video has had time to load,
      // because `readyState` and `videoWidth` are only meaningful later.
      const artRef = React.useRef(null)
      const kind = item === null ? 'none' : item.kind === 'video' ? 'video' : 'image'
      React.useEffect(() => {
        if (!visible) {
          reportBackdrop(null, 'none')
          return undefined
        }
        reportBackdrop(artRef.current, kind)
        const timer = window.setTimeout(() => reportBackdrop(artRef.current, kind), 1500)
        return () => window.clearTimeout(timer)
      }, [visible, kind, item === null ? null : item.url])

      return visible
        ? [
            // Video and stills need different elements: a `<video>` for the
            // former (it must loop, stay muted and honour the same opacity and
            // blur controls), a `background-image` layer for the latter. Both
            // share `.wp-backdrop` so every positioning rule stays in one place.
            item.kind === 'video'
              ? React.createElement(
                  'video',
                  {
                    key: 'art',
                    ref: artRef,
                    className: 'wp-backdrop',
                    // Marks this element for the size rule that a replaced
                    // element needs; see the CSS above.
                    'data-wp-video': '',
                    src: item.url,
                    autoPlay: true,
                    loop: true,
                    muted: true,
                    playsInline: true,
                    // Video decoding is real GPU/CPU work, so it is dropped
                    // together with the rest of the layer when the wallpaper is
                    // turned off rather than left running behind the shell.
                    preload: 'auto',
                    style: {
                      objectFit: fit === 'fill' ? 'fill' : fit === 'tile' ? 'cover' : fit,
                      opacity: opacity / 100,
                      filter: blur > 0 ? 'blur(' + blur + 'px)' : 'none',
                      transform: blur > 0 ? 'scale(1.05)' : 'none',
                    },
                  },
                )
              : React.createElement('div', {
                  key: 'art',
                  ref: artRef,
                  className: 'wp-backdrop',
                  style: {
                    backgroundImage: 'url("' + item.url + '")',
                    backgroundSize: fit === 'fill' ? '100% 100%' : fit,
                    opacity: opacity / 100,
                    filter: blur > 0 ? 'blur(' + blur + 'px)' : 'none',
                    transform: blur > 0 ? 'scale(1.05)' : 'none',
                  },
                }),
            React.createElement('div', {
              key: 'scrim',
              className: 'wp-scrim',
              style: { background: 'rgba(0, 0, 0, ' + dim / 100 + ')' },
            }),
          ]
        : null
    }

    function Settings() {
      const snapshot = useStore()
      const state = snapshot.state
      const item = currentItem()
      const fileRef = React.useRef(null)
      // Which tile is armed for deletion. A wallpaper can be tens of megabytes
      // and is removed from disk on confirm, so a single stray click must not
      // be enough to destroy an upload.
      const confirmPair = React.useState(null)
      const confirmId = confirmPair[0]
      const setConfirmId = confirmPair[1]

      React.useEffect(() => {
        refresh()
      }, [])

      // Disarm on its own so an armed tile never lingers as a trap.
      React.useEffect(() => {
        if (confirmId === null) return undefined
        const timer = window.setTimeout(() => setConfirmId(null), 4000)
        return () => window.clearTimeout(timer)
      }, [confirmId])

      async function onPick(event) {
        const picked = event.target.files
        if (picked === null || picked.length === 0) return
        const files = Array.from(picked)
        store.busy = true
        store.error = null
        store.notice = null
        emit()
        const tooBig = []
        let added = 0
        try {
          for (const file of files) {
            // Checked before reading: the previous implementation read every
            // file into a base64 string up front, so peak memory was the sum of
            // all of them. Uploading one at a time bounds it to a single file.
            if (file.size > MAX_UPLOAD_FILE_BYTES) {
              tooBig.push(file.name)
              continue
            }
            const dataUrl = await readAsDataUrl(file)
            adopt(await request('/upload', { images: [{ name: file.name, dataUrl }] }))
            added += 1
          }
          store.error = null
          const notes = []
          if (added > 0) notes.push('已添加 ' + added + ' 个素材')
          if (tooBig.length > 0) notes.push('跳过 ' + tooBig.length + ' 个超过 ' + humanSize(MAX_UPLOAD_FILE_BYTES) + ' 的文件')
          store.notice = notes.length > 0 ? notes.join(' · ') : null
          if (tooBig.length > 0) {
            store.error = '以下文件超过 ' + humanSize(MAX_UPLOAD_FILE_BYTES) + ' 未上传:' + tooBig.join('、')
          }
        } catch (error) {
          store.error = String((error && error.message) || error)
        }
        store.busy = false
        if (fileRef.current !== null) fileRef.current.value = ''
        emit()
      }

      const uploadCard = React.createElement(
        'div',
        { className: 'wp-card' },
        React.createElement('p', { className: 'wp-head' }, '本地壁纸'),
        React.createElement(
          'p',
          { className: 'wp-sub' },
          state.items.length === 0
            ? '上传本地图片或视频即可作为应用壁纸,所有改动立即生效,无需刷新页面。'
            : '共 ' + state.items.length + ' 个 · 当前 ' +
              (item === null ? '未选择' : item.name) +
              // Parenthesised: a bare `+` before a ternary binds tighter than
              // the ternary, which would drop the whole prefix once rotation is
              // off instead of appending a suffix.
              (state.rotate
                ? ' · 每 ' + intervalLabel(state.intervalMs) + ' 自动轮换'
                : ' · 自动轮换已关闭'),
        ),
        React.createElement(
          'div',
          { className: 'wp-row', style: { marginTop: 12 } },
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            React.createElement('input', {
              ref: fileRef,
              type: 'file',
              // Video is accepted alongside stills; the host accepts the same
              // set and derives each item's kind from its extension.
              accept: 'image/*,video/mp4,video/webm,video/ogg,.mp4,.webm,.m4v,.mov',
              multiple: true,
              onChange: onPick,
              style: { display: 'none' },
            }),
            React.createElement(
              'button',
              {
                className: 'wp-btn on',
                disabled: snapshot.busy,
                onClick: () => {
                  if (fileRef.current !== null) fileRef.current.click()
                },
              },
              snapshot.busy ? '处理中…' : '上传图片 / 视频',
            ),
            React.createElement(
              'button',
              {
                className: 'wp-btn',
                disabled: snapshot.busy || state.items.length === 0,
                onClick: () => mutate('/step', { delta: -1 }),
              },
              '上一张',
            ),
            React.createElement(
              'button',
              {
                className: 'wp-btn',
                disabled: snapshot.busy || state.items.length === 0,
                onClick: () => mutate('/step', { delta: 1 }),
              },
              '下一张',
            ),
          ),
        ),
        snapshot.error !== null ? React.createElement('p', { className: 'wp-err' }, snapshot.error) : null,
        snapshot.error === null && snapshot.notice !== null
          ? React.createElement('p', { className: 'wp-ok' }, snapshot.notice)
          : null,
        state.items.length === 0
          ? React.createElement('div', { className: 'wp-empty' }, '还没有壁纸图片,点击上方「上传本地图片」添加。')
          : React.createElement(
              'div',
              { className: 'wp-grid' },
              state.items.map((entry) =>
                React.createElement(
                  'div',
                  {
                    key: entry.id,
                    className: 'wp-tile' + (entry.id === state.currentId ? ' on' : ''),
                    title: '点击切换为 ' + entry.name,
                    onClick: () => mutate('/select', { id: entry.id }, '已切换为 ' + entry.name),
                  },
                  // An <img> cannot render an mp4, so a video entry previews
                  // through a muted <video> element instead. preload="metadata"
                  // keeps the tile cheap: it fetches just enough to paint the
                  // first frame rather than pulling the whole file per tile.
                  entry.kind === 'video'
                    ? React.createElement('video', {
                        className: 'wp-thumb',
                        src: entry.url,
                        muted: true,
                        loop: true,
                        playsInline: true,
                        preload: 'metadata',
                        onMouseOver: (event) => {
                          const node = event.currentTarget
                          const played = node.play()
                          if (played && typeof played.catch === 'function') played.catch(() => {})
                        },
                        onMouseOut: (event) => event.currentTarget.pause(),
                      })
                    : React.createElement('img', { className: 'wp-thumb', src: entry.url, alt: entry.name }),
                  entry.kind === 'video'
                    ? React.createElement(
                        'span',
                        { className: 'wp-tag', style: { left: 'auto', right: '44px' } },
                        '视频',
                      )
                    : null,
                  entry.id === state.currentId
                    ? React.createElement('span', { className: 'wp-tag' }, '使用中')
                    : null,
                  React.createElement(
                    'button',
                    {
                      className: 'wp-del' + (confirmId === entry.id ? ' armed' : ''),
                      title: confirmId === entry.id ? '再点一次即删除' : '删除',
                      onClick: (event) => {
                        event.stopPropagation()
                        // Two-step: the first click only arms this tile.
                        if (confirmId !== entry.id) {
                          setConfirmId(entry.id)
                          return
                        }
                        setConfirmId(null)
                        mutate('/remove', { id: entry.id }, '已删除 ' + entry.name)
                      },
                    },
                    confirmId === entry.id ? '确认?' : '删除',
                  ),
                  React.createElement('div', { className: 'wp-name' }, entry.name + ' · ' + humanSize(entry.bytes)),
                ),
              ),
            ),
      )

      function toggleRow(label, value, onToggle) {
        return React.createElement(
          'div',
          { className: 'wp-row' },
          React.createElement('span', { className: 'wp-label' }, label),
          React.createElement(
            'button',
            { className: 'wp-btn' + (value ? ' on' : ''), onClick: () => onToggle(!value) },
            value ? '已开启' : '已关闭',
          ),
        )
      }

      function sliderRow(label, value, min, max, step, onApply, suffix) {
        return React.createElement(
          'div',
          { className: 'wp-row' },
          React.createElement('span', { className: 'wp-label' }, label),
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('input', {
              className: 'wp-range',
              type: 'range',
              min: min,
              max: max,
              step: step,
              value: value,
              onChange: (event) => onApply(Number(event.target.value)),
            }),
            React.createElement('span', { className: 'wp-val' }, value + suffix),
          ),
        )
      }

      const controlCard = React.createElement(
        'div',
        { className: 'wp-card' },
        React.createElement('p', { className: 'wp-head' }, '切换与轮动'),
        toggleRow('启用壁纸', state.enabled, (next) => mutate('/config', { patch: { enabled: next } })),
        toggleRow('自动轮换', state.rotate, (next) => mutate('/config', { patch: { rotate: next } })),
        toggleRow('随机顺序', state.shuffle, (next) => mutate('/config', { patch: { shuffle: next } })),
        React.createElement(
          'div',
          { className: 'wp-row' },
          React.createElement('span', { className: 'wp-label' }, '轮换间隔'),
          React.createElement(
            'div',
            { className: 'wp-seg', style: state.rotate ? undefined : { opacity: 0.45 } },
            PRESET_INTERVALS.map((pair) =>
              React.createElement(
                'button',
                {
                  key: pair[0],
                  className: state.intervalMs === pair[0] ? 'on' : '',
                  // Disabled while rotation is off: the value is still stored
                  // and shown, but changing it cannot have a visible effect, so
                  // accepting the click would only look broken.
                  disabled: !state.rotate,
                  onClick: () => mutate('/config', { patch: { intervalMs: pair[0] } }, '轮换间隔已设为 ' + pair[1]),
                },
                pair[1],
              ),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'wp-row' },
          React.createElement('span', { className: 'wp-label' }, '填充方式'),
          React.createElement(
            'div',
            { className: 'wp-seg' },
            [['cover', '铺满'], ['contain', '完整'], ['fill', '拉伸'], ['tile', '平铺']].map((pair) =>
              React.createElement(
                'button',
                {
                  key: pair[0],
                  className: state.fit === pair[0] ? 'on' : '',
                  onClick: () => mutate('/config', { patch: { fit: pair[0] } }, null),
                },
                pair[1],
              ),
            ),
          ),
        ),
        // Guarded with the same fallbacks the backdrop uses, so an older host
        // half cannot leave a slider bound to undefined.
        sliderRow('壁纸清晰度', pct(state.opacity, 40), 5, 100, 5, (v) => mutate('/config', { patch: { opacity: v } }, null), '%'),
        sliderRow('文字压暗', pct(state.dim, 0), 0, 90, 5, (v) => mutate('/config', { patch: { dim: v } }, null), '%'),
        sliderRow('背景模糊', pct(state.blur, 0), 0, 60, 5, (v) => mutate('/config', { patch: { blur: v } }, null), 'px'),
        React.createElement(
          'p',
          { className: 'wp-sub', style: { marginTop: 8 } },
          '「壁纸清晰度」越高图片越鲜明;「文字压暗」在壁纸之上压一层暗色,调高可让界面文字更清楚。' +
            '浅色主题下 40% 左右观感接近皮肤中心。' +
            '轮换由后台进程计时:即使关闭页面,壁纸仍按间隔自动切换。' +
            (snapshot.root === null ? '' : '图片保存在 ' + snapshot.root + '。'),
        ),
      )

      return React.createElement('div', { className: 'wp-page' }, uploadCard, controlCard)
    }

    let styleDispose = null

    function mountStyles() {
      if (styleDispose !== null) return
      const element = document.createElement('style')
      element.setAttribute('data-dsh-wallpaper', '')
      element.textContent = CSS
      document.head.appendChild(element)
      styleDispose = () => {
        element.remove()
        styleDispose = null
      }
    }

    /**
     * Mount the background layer and the settings page.
     * @param ctx client root context.
     */
    function apply(ctx) {
      mountStyles()
      ctx.effect(() => () => {
        if (styleDispose !== null) styleDispose()
      }, 'wallpaper: styles')

      const slots = ctx.slots
      if (slots === undefined || slots === null) return

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: -100 }, () =>
          React.createElement(Backdrop, null),
        ),
      )

      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: SECTION_ID, order: 118, label: () => '本地壁纸' }, () =>
          React.createElement(Settings, null),
        ),
      )

      // The rotation clock lives on the host, so an automatic switch is
      // observed through the revision counter rather than a local timer. The
      // probe now returns only that counter, so the full state is fetched only
      // when it actually moves.
      ctx.effect(() => {
        let stopped = false
        const probe = () => {
          if (stopped) return
          // A hidden page does not repaint, so a rotation tick cannot be seen
          // while it is hidden; polling through it only burns requests.
          if (document.hidden) return
          request('/revision')
            .then((payload) => {
              if (Number.isFinite(payload.revision) && payload.revision !== store.state.revision) {
                return refresh()
              }
              return undefined
            })
            .catch(() => {})
        }
        const handle = window.setInterval(probe, POLL_MS)
        // Becoming visible again is exactly when the backdrop may be stale, so
        // refresh at once rather than waiting for the next tick.
        const onVisible = () => {
          if (!document.hidden) probe()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          stopped = true
          window.clearInterval(handle)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, 'wallpaper: revision poll')
    }

    exports.apply = apply
    return module.exports
  },
})
