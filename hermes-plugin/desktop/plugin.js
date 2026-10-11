// iPhone Use — Hermes Desktop live-screen pane (unified agent+desktop package half).
//
// Ported from ui/src/app.ts + ui/index.html + ui/style.css of zhongerxin/iPhone-use.
// The Codex widget talks to the MCP server over stdio (ext-apps); this pane talks
// to the same ScreenHub through the loopback HTTP bridge (server/screen_http.py)
// via ctx.rest → gateway /api/plugins/iphone-screen → 127.0.0.1:18199.
//
// No build step: plain ESM, imports restricted to @hermes/plugin-sdk + react.
// CSS is inlined with every selector prefixed .ips- so it cannot leak into the app.
import { jsx, jsxs } from 'react/jsx-runtime'
import * as React from 'react'

const { useRef, useEffect } = React

// ---------------------------------------------------------------------------
// Inlined styles — every selector is .ips- prefixed; the design tokens map onto
// the app's live theme variables so the pane follows dark/light automatically.
// ---------------------------------------------------------------------------
const STYLE = `
.ips-root{color-scheme:light dark;background:transparent;--canvas:transparent;--canvas-dot:transparent;--text:var(--ui-text-primary);--muted:var(--ui-text-secondary);--surface:var(--ui-bg-elevated);--surface-hover:var(--ui-control-hover-background);--line:var(--ui-stroke-secondary);--control-shadow:0 2px 12px #00000008;--accent:var(--ui-accent);--warn:#e0a84a;--toast:#202123f2;--toast-text:#fff}
.ips-root *{box-sizing:border-box}
.ips-root .ips-app{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 14px 12px;overflow:hidden;background-color:var(--canvas);background-image:radial-gradient(circle,var(--canvas-dot) .8px,transparent 1px);background-size:20px 20px;color:var(--text);font:500 12px/1 ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.ips-root .ips-status{flex:none;display:inline-flex;align-items:center;gap:8px;max-width:100%;height:28px;padding:0 12px;border:.5px solid var(--line);border-radius:999px;background:var(--surface);box-shadow:var(--control-shadow);letter-spacing:.01em;white-space:nowrap;user-select:none}
.ips-root .ips-model{overflow:hidden;text-overflow:ellipsis;font-weight:600}
.ips-root .ips-live{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--muted)}
.ips-root .dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.55}
.ips-root .ips-app[data-live="live"] .ips-live{color:var(--accent)}
.ips-root .ips-app[data-live="live"] .dot{opacity:1;animation:ips-live-pulse 2.4s ease-in-out infinite}
.ips-root .ips-app[data-live="paused"] .ips-live{color:var(--warn)}
.ips-root .ips-stage{flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}
.ips-root .ips-toolbar{flex:none;display:inline-flex;align-items:center;gap:2px;padding:4px;border:.5px solid var(--line);border-radius:999px;background:var(--surface);box-shadow:var(--control-shadow)}
.ips-root .ips-toolbar button{appearance:none;display:grid;place-items:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--text);cursor:pointer;transition:background-color .15s ease,transform .1s ease,opacity .15s ease}
.ips-root .ips-toolbar button:hover{background:var(--surface-hover)}
.ips-root .ips-toolbar button:active{transform:scale(.94)}
.ips-root .ips-toolbar button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ips-root .ips-toolbar button:disabled{opacity:.35;cursor:default;background:transparent;transform:none}
.ips-root .ips-toolbar button[data-busy="true"]{opacity:1;animation:ips-tool-busy 1s ease-in-out infinite}
.ips-root .ips-toolbar svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.ips-root .ips-toast{position:absolute;left:50%;bottom:70px;z-index:5;max-width:calc(100% - 32px);padding:7px 12px;overflow:hidden;border-radius:999px;background:var(--toast);color:var(--toast-text);line-height:1.2;text-overflow:ellipsis;white-space:nowrap;transform:translateX(-50%);box-shadow:0 6px 20px -8px #00000059;pointer-events:none;animation:ips-toast-in .18s ease-out}
.ips-root .ips-toast[data-tone="error"]{background:#b42318f2;color:#fff}
.ips-root .ips-toast[hidden]{display:none}
.ips-root .ips-device{--bezel:10px;--screen-radius:50px;position:relative;width:min(100%,350px);aspect-ratio:460/976;flex:none;isolation:isolate;border-radius:calc(var(--screen-radius) + var(--bezel));background:linear-gradient(115deg,#c4c0b9 0%,#686662 12%,#b1ada6 24%,#555452 51%,#96938e 72%,#c9c6c0 91%,#686762 100%);box-shadow:0 0 0 .7px #252525ad,0 12px 28px -14px #00000055,0 4px 8px -4px #00000033;user-select:none;pointer-events:none}
.ips-root .ips-device::before{content:"";position:absolute;inset:calc(var(--bezel) * .24);z-index:1;border-radius:calc(var(--screen-radius) + var(--bezel) * .76);background:#090a0c;box-shadow:0 0 0 .7px #00000099,inset 0 0 0 .7px #ffffff16;pointer-events:none}
.ips-root .ips-screen{position:absolute;inset:var(--bezel);z-index:2;isolation:isolate;overflow:hidden;border-radius:var(--screen-radius);background:#050609;line-height:0;user-select:none}
.ips-root .ips-device[hidden],.ips-root .ips-screen[hidden],.ips-root .gesture-cursor[hidden]{display:none}
.ips-root .side-button{position:absolute;z-index:0;width:calc(var(--bezel) * .27);left:calc(var(--bezel) * -.22);border-radius:calc(var(--bezel) * .15);background:linear-gradient(90deg,#5a5956,#b1aea7 55%,#5e5c59);box-shadow:0 0 0 .4px #35353280;pointer-events:none}
.ips-root .action-button{top:15%;height:3.7%}
.ips-root .volume-up{top:23%;height:6.4%}
.ips-root .volume-down{top:32%;height:6.4%}
.ips-root .power-button{left:auto;right:calc(var(--bezel) * -.22);top:26%;height:10.4%;background:linear-gradient(90deg,#5e5c59,#aaa7a1 45%,#5a5956)}
.ips-root .receiver{position:absolute;left:50%;top:calc(var(--bezel) * .36);z-index:3;width:15%;height:calc(var(--bezel) * .19);transform:translateX(-50%);border-radius:999px;background:#030405;box-shadow:0 .5px 0 #ffffff19;pointer-events:none}
.ips-root .ips-device[data-orientation="landscape"] .side-button{left:auto;top:calc(var(--bezel) * -.22);height:calc(var(--bezel) * .27);background:linear-gradient(180deg,#5a5956,#b1aea7 55%,#5e5c59)}
.ips-root .ips-device[data-orientation="landscape"] .action-button{left:15%;width:3.7%}
.ips-root .ips-device[data-orientation="landscape"] .volume-up{left:23%;width:6.4%}
.ips-root .ips-device[data-orientation="landscape"] .volume-down{left:32%;width:6.4%}
.ips-root .ips-device[data-orientation="landscape"] .power-button{left:26%;right:auto;top:auto;bottom:calc(var(--bezel) * -.22);width:10.4%;background:linear-gradient(180deg,#5e5c59,#aaa7a1 45%,#5a5956)}
.ips-root .ips-device[data-orientation="landscape"] .receiver{left:calc(var(--bezel) * .36);top:50%;width:calc(var(--bezel) * .19);height:15%;transform:translateY(-50%)}
.ips-root .ips-image{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:contain;user-select:none;pointer-events:none}
.ips-root .ips-image[hidden],.ips-root .ips-empty-state[hidden]{display:none}
.ips-root .ips-empty-state{position:absolute;inset:0;z-index:1;display:grid;place-items:center;background:radial-gradient(ellipse at 12% 0%,#ffffff08,transparent 56%),linear-gradient(145deg,#16171a,#090a0c 48%,#050609);color:#a9abb0;user-select:none}
.ips-root .empty-state-content{display:flex;align-items:center;justify-content:center;max-width:calc(100% - 32px)}
.ips-root .ips-empty-state-text{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ips-root .empty-state-icon{width:36px;height:36px;flex:none;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round;color:#b8babf}
.ips-root .empty-state-icon g{display:none}
.ips-root .ips-empty-state[data-state="connecting"] [data-icon="connecting"],.ips-root .ips-empty-state[data-state="offline"] [data-icon="offline"],.ips-root .ips-empty-state[data-state="locked"] [data-icon="locked"],.ips-root .ips-empty-state[data-state="authentication"] [data-icon="authentication"],.ips-root .ips-empty-state[data-state="paused"] [data-icon="paused"],.ips-root .ips-empty-state[data-state="unavailable"] [data-icon="unavailable"]{display:block}
.ips-root .empty-state-icon .symbol-dot{fill:currentColor;stroke:none}
.ips-root .ips-empty-state[data-state="connecting"] [data-icon="connecting"]{transform-box:view-box;transform-origin:center;animation:ips-connecting-spin 1s linear infinite}
.ips-root .ips-app[data-page-visible="false"] [data-icon="connecting"]{animation-play-state:paused}
.ips-root .dynamic-island{position:absolute;z-index:3;left:50%;top:calc(var(--bezel) * 1.17);width:calc(var(--bezel) * 11.25);height:calc(var(--bezel) * 3.46);transform:translateX(-50%);border-radius:999px;background:#030405;box-shadow:0 0 0 .5px #00000099,inset 0 .5px 0 #ffffff0d;pointer-events:none}
.ips-root .dynamic-island::after{content:"";position:absolute;right:calc(var(--bezel) * .66);top:50%;width:calc(var(--bezel) * 1.65);height:calc(var(--bezel) * 1.65);transform:translateY(-50%);border-radius:50%;background:radial-gradient(circle at 43% 38%,#274271 0%,#111d31 27%,#090c12 54%,#010203 73%);box-shadow:inset 0 0 0 .6px #111620;opacity:.7}
.ips-root .ips-device[data-orientation="landscape"] .dynamic-island{left:calc(var(--bezel) * 2.9);top:50%;transform:translate(-50%,-50%) rotate(-90deg)}
.ips-root .gesture-cursor{position:absolute;z-index:4;width:26px;height:26px;margin:-13px 0 0 -13px;border:1.5px solid #ffffffe6;border-radius:50%;background:#80808066;box-shadow:0 0 0 1px #4c4c4c66,0 2px 6px #00000026;pointer-events:none;will-change:transform,opacity}
@keyframes ips-live-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes ips-tool-busy{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes ips-toast-in{from{opacity:0}to{opacity:1}}
@keyframes ips-connecting-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.ips-root .ips-app[data-live="live"] .dot,.ips-root .ips-toolbar button[data-busy="true"],.ips-root .ips-toast,.ips-root .ips-empty-state[data-state="connecting"] [data-icon="connecting"]{animation:none}.ips-root .ips-toolbar button{transition:none}.ips-root .gesture-cursor{will-change:opacity}}
`

// Inlined markup — the widget's main#app structure, ids renamed to .ips- classes
// (the pane re-queries them on mount). The glow layer is kept in the DOM but
// never lit: its SVG masks are generated per frame and dropped for v1.
const MARKUP = `
<main class="ips-app" data-frame-seq="0" data-busy="false" data-operating="false" data-live="connecting" aria-label="iPhone 实时屏幕">
  <header class="ips-status">
    <span class="ips-model">iPhone</span>
    <span class="ips-live"><i class="dot" aria-hidden="true"></i><span class="ips-live-text">连接中</span></span>
  </header>
  <div class="ips-stage">
    <div class="ips-device" data-orientation="portrait">
      <div class="side-button action-button" aria-hidden="true"></div>
      <div class="side-button volume-up" aria-hidden="true"></div>
      <div class="side-button volume-down" aria-hidden="true"></div>
      <div class="side-button power-button" aria-hidden="true"></div>
      <div class="receiver" aria-hidden="true"></div>
      <div class="ips-screen">
        <img class="ips-image" alt="iPhone 实时屏幕" draggable="false" hidden>
        <div class="ips-empty-state" data-state="connecting" role="status" aria-live="polite">
          <div class="empty-state-content">
            <svg class="empty-state-icon" viewBox="0 0 24 24" aria-hidden="true">
              <g data-icon="connecting"><circle cx="12" cy="12" r="8" opacity=".2"/><path d="M12 4a8 8 0 0 1 8 8"/></g>
              <g data-icon="offline"><path d="M8.5 3.25h7A2.25 2.25 0 0 1 17.75 5.5v7M6.25 9v9.5a2.25 2.25 0 0 0 2.25 2.25h7a2.25 2.25 0 0 0 2.25-2.25v-1"/><path d="M10.25 5.75h3.5M10.5 18.25h3M3.25 3.25l17.5 17.5"/></g>
              <g data-icon="locked"><rect x="5.5" y="10.25" width="13" height="10.5" rx="2.75"/><path d="M8 10.25v-3a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.25"/></g>
              <g data-icon="authentication"><path d="M12 2.75 20 6v5c0 4.5-3.5 7.8-8 10.25C7.5 18.8 4 15.5 4 11V6Z"/><rect x="8.5" y="10.75" width="7" height="5.5" rx="1.5"/><path d="M10 10.75V9a2 2 0 0 1 4 0v1.75"/></g>
              <g data-icon="paused"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 8.5v7M14.5 8.5v7"/></g>
              <g data-icon="unavailable"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.75"/><circle class="symbol-dot" cx="12" cy="16.5" r=".8"/></g>
            </svg>
            <span class="ips-empty-state-text">正在连接</span>
          </div>
        </div>
        <div class="dynamic-island" aria-hidden="true"></div>
        <div class="gesture-cursor ips-cursor" aria-hidden="true" hidden></div>
      </div>
    </div>
  </div>
  <div class="ips-toast" role="status" aria-live="polite" hidden></div>
  <nav class="ips-toolbar" aria-label="手机工具">
    <button class="ips-tool-refresh" type="button" aria-label="刷新连接" title="重新连接；认证完成后点击可恢复预览">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 8.25A7.5 7.5 0 1 0 19.5 12"/><path d="M18.5 4.25v4h-4"/></svg>
    </button>
    <button class="ips-tool-home" type="button" aria-label="回到主屏幕" title="回到主屏幕">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 10.75 6.3-5.3a1.85 1.85 0 0 1 2.4 0l6.3 5.3"/><path d="M6.5 9.15V18A1.5 1.5 0 0 0 8 19.5h8a1.5 1.5 0 0 0 1.5-1.5V9.15"/><path d="M10 19.5v-5.75h4v5.75"/></svg>
    </button>
    <button class="ips-tool-screenshot" type="button" aria-label="截图到剪贴板" title="截图到剪贴板">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 6.5 1.2-1.75h4.6l1.2 1.75H18a1.75 1.75 0 0 1 1.75 1.75v9.5A1.75 1.75 0 0 1 18 19.5H6a1.75 1.75 0 0 1-1.75-1.75v-9.5A1.75 1.75 0 0 1 6 6.5Z"/><circle cx="12" cy="12.75" r="3.25"/></svg>
    </button>
  </nav>
</main>`

// ---------------------------------------------------------------------------
// Controller — a line-for-line port of ui/src/app.ts. The only transport change:
// app.callServerTool({name, arguments}) → restFetch(), which hits the gateway's
// /api/plugins/iphone-screen namespace. The pane polls; the bridge only exists
// while the iphone-use MCP server is running, and a downed bridge answers with
// service_ready:false instead of an error.
// ---------------------------------------------------------------------------

const FRAME_INTERVAL = 250
const REQUEST_TIMEOUT = 3000
// A screenshot or Home may queue behind the phone operation already running.
const ACTION_TIMEOUT = 12000

const LIVE_TEXT = { connecting: '连接中', live: 'Live', paused: '已暂停', offline: '未连接' }
const EMPTY_TEXT = {
  connecting: '正在连接', offline: '未连接', locked: '等待解锁',
  authentication: '请完成认证', paused: '预览已暂停', unavailable: '画面暂不可用',
}
const DONE = { refresh: '已刷新连接', home: '已回到主屏幕', screenshot: '截图已复制到剪贴板' }
const FAILED = {
  device_busy: '手机正在执行操作，请稍后再试',
  preview_paused: '认证接管期间已暂停',
  clipboard_unavailable: '截图未能写入剪贴板',
  pua_unreachable: '未连接到手机',
  bridge_unavailable: 'iPhone Use 服务未运行，请先让 agent 操作一次手机',
}

function createController(ctx, root) {
  const rest = ctx.rest.bind(ctx)
  const device = root.querySelector('.ips-device')
  const screen = root.querySelector('.ips-screen')
  const image = root.querySelector('.ips-image')
  const emptyState = root.querySelector('.ips-empty-state')
  const emptyText = root.querySelector('.ips-empty-state-text')
  const cursor = root.querySelector('.ips-cursor')
  const stage = root.querySelector('.ips-stage')
  const model = root.querySelector('.ips-model')
  const liveText = root.querySelector('.ips-live-text')
  const toast = root.querySelector('.ips-toast')
  const tools = {
    refresh: root.querySelector('.ips-tool-refresh'),
    home: root.querySelector('.ips-tool-home'),
    screenshot: root.querySelector('.ips-tool-screenshot'),
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let ready = false
  let disposed = false
  let inFlight = false
  let frameSeq = 0
  let frameGeneration = 0
  let streamId
  let eventId = 0
  let dimensions
  let viewport
  let timer
  let failures = 0
  let serviceUnavailable = false
  const cursorEffects = new Set()
  let lastGoodFrame
  let acting = false
  let toastTimer

  const validSize = (value) => {
    const size = value
    return !!size && Number.isFinite(size.width) && Number.isFinite(size.height)
      && size.width > 0 && size.height > 0
  }
  const validPoint = (value) => {
    const point = value
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }

  // The pane's one door to the phone: gateway → loopback bridge → ScreenHub.
  const restFetch = (path, opts) => rest(path, { timeoutMs: opts?.timeout, ...opts })

  function syncTools() {
    const paused = root.dataset.live === 'paused'
    tools.refresh.disabled = acting
    // While the user authenticates on the phone nothing is captured or sent from here.
    tools.home.disabled = tools.screenshot.disabled = acting || paused
  }

  function showEmpty(state) {
    emptyState.dataset.state = state
    emptyText.textContent = EMPTY_TEXT[state]
  }

  function setLive(state) {
    if (!image.src) showEmpty(state === 'paused' ? 'paused' : state === 'offline' ? 'offline' : 'connecting')
    if (root.dataset.live === state) return
    root.dataset.live = state
    liveText.textContent = LIVE_TEXT[state]
    liveText.title = ''
    syncTools()
  }

  function notify(text, failed = false) {
    toast.textContent = text
    toast.dataset.tone = failed ? 'error' : 'ok'
    toast.hidden = false
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastTimer = undefined; toast.hidden = true }, 1800)
  }

  function finishCursor(effect) {
    if (!cursorEffects.delete(effect)) return
    effect.animation?.cancel()
    if (effect.timer) clearTimeout(effect.timer)
    effect.node.hidden = true
    if (effect.node !== cursor) effect.node.remove()
  }

  function hideCursor() {
    for (const effect of cursorEffects) finishCursor(effect)
  }

  function clearFrame(resetOperating = true) {
    const hadDimensions = !!dimensions
    frameGeneration++
    hideCursor()
    image.removeAttribute('src')
    image.hidden = true
    emptyState.hidden = false
    device.hidden = screen.hidden = disposed
    dimensions = undefined
    lastGoodFrame = undefined
    frameSeq = 0
    root.dataset.frameSeq = '0'
    root.dataset.busy = 'false'
    if (resetOperating) root.dataset.operating = 'false'
    if (!disposed && hadDimensions) fitFrame()
  }

  function retainFrame() {
    hideCursor()
    root.dataset.busy = 'false'
  }

  const visible = () => !disposed && !document.hidden

  function fitFrame() {
    const size = dimensions ?? viewport ?? { width: 440, height: 956 }
    // The stage is what remains between the status pill and the toolbar.
    const width = stage.clientWidth
    const height = stage.clientHeight
    const shortSide = Math.min(size.width, size.height)
    const bezel = shortSide * .024
    const outerWidth = size.width + 2 * bezel
    const outerHeight = size.height + 2 * bezel
    const scale = .96 * Math.min(width / outerWidth, height / outerHeight)
    device.style.width = `${outerWidth * scale}px`
    device.style.height = `${outerHeight * scale}px`
    device.style.setProperty('--bezel', `${bezel * scale}px`)
    const radius = shortSide * .12 * scale
    device.style.setProperty('--screen-radius', `${radius}px`)
    device.dataset.orientation = size.width > size.height ? 'landscape' : 'portrait'
  }

  function pointStyle(point, size) {
    return {
      left: `${Math.max(0, Math.min(1, point.x / size.width)) * 100}%`,
      top: `${Math.max(0, Math.min(1, point.y / size.height)) * 100}%`,
    }
  }

  function showGesture(gesture) {
    if (screen.hidden || image.hidden) return
    const size = validSize(gesture.viewport) ? gesture.viewport : viewport
    if (!size) return
    if (dimensions && Math.abs((size.width / size.height) / (dimensions.width / dimensions.height) - 1) > .08) return
    const point = gesture.kind === 'tap' ? gesture.point : gesture.from
    if (!validPoint(point)) return
    if (gesture.kind === 'drag' && !validPoint(gesture.to)) return
    // Keep each indication readable even when several real actions arrive together.
    // Overlapping effects have independent lifetimes, so a new tap cannot erase one.
    const marker = cursor.hidden ? cursor : cursor.cloneNode(false)
    if (marker !== cursor) screen.appendChild(marker)
    Object.assign(marker.style, pointStyle(point, size))
    marker.hidden = false
    const effect = { node: marker }
    cursorEffects.add(effect)
    const movement = Math.max(600, Math.min(1000, gesture.duration_ms || 650))
    const duration = gesture.kind === 'drag' ? movement + 1000 : 1600
    if (reducedMotion.matches) {
      if (gesture.kind === 'drag') Object.assign(marker.style, pointStyle(gesture.to, size))
      effect.timer = setTimeout(() => finishCursor(effect), duration)
      return
    }
    const delta = gesture.kind === 'drag'
      ? `translate(${(gesture.to.x - point.x) / size.width * screen.clientWidth}px, ${(gesture.to.y - point.y) / size.height * screen.clientHeight}px)`
      : ''
    const frames = gesture.kind === 'drag'
      ? [
        { transform: 'translate(0, 0) scale(.96)', opacity: 0 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 80 / duration },
        { transform: 'translate(0, 0) scale(.92)', opacity: 1, offset: 200 / duration, easing: 'cubic-bezier(.3,0,.2,1)' },
        { transform: `${delta} scale(.92)`, opacity: 1, offset: (movement + 200) / duration },
        { transform: `${delta} scale(1.06)`, opacity: 1, offset: (movement + 380) / duration },
        { transform: `${delta} scale(1)`, opacity: 1, offset: (duration - 350) / duration },
        { transform: `${delta} scale(1)`, opacity: 1, offset: (duration - 200) / duration },
        { transform: `${delta} scale(.98)`, opacity: 0 },
      ]
      : [
        { transform: 'scale(.96)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1, offset: .06 },
        { transform: 'scale(.9)', opacity: 1, offset: .16 },
        { transform: 'scale(1.06)', opacity: 1, offset: .28 },
        { transform: 'scale(1)', opacity: 1, offset: .4 },
        { transform: 'scale(1)', opacity: 1, offset: .875 },
        { transform: 'scale(.98)', opacity: 0 },
      ]
    effect.animation = marker.animate(frames, { duration, easing: 'linear' })
    effect.animation.onfinish = () => finishCursor(effect)
  }

  function consume(value) {
    if (disposed || !value || typeof value !== 'object') return
    const preview = value
    if (typeof preview.service_ready === 'boolean') serviceUnavailable = !preview.service_ready
    if (typeof preview.stream_id === 'string' && preview.stream_id !== streamId) {
      streamId = preview.stream_id
      // Sequence numbers restart with the server, but keep the last pixels until
      // its replacement is ready. Authentication pause remains an explicit erase.
      frameSeq = 0
      eventId = 0
      root.dataset.operating = 'false'
      retainFrame()
    }
    if (typeof preview.device?.model === 'string' && preview.device.model) model.textContent = preview.device.model
    if (validSize(preview.viewport) && (viewport?.width !== preview.viewport.width || viewport?.height !== preview.viewport.height)) {
      viewport = preview.viewport
      if (!dimensions) fitFrame()
    }
    if (preview.paused === true) {
      clearFrame()
      setLive('paused')
      liveText.textContent = preview.pause_reason === 'device_locked' ? '等待解锁' : LIVE_TEXT.paused
      liveText.title = preview.pause_reason === 'device_locked'
        ? '解锁 iPhone 后继续任务，或点击刷新恢复预览'
        : '预览已暂停；完成手机认证后继续任务或点击刷新恢复画面'
      showEmpty(preview.pause_reason === 'device_locked' ? 'locked'
        : preview.pause_reason === 'authentication' ? 'authentication' : 'paused')
      return
    }
    if (preview.frame_available === false) {
      retainFrame()
      // The stream has no frame while USB capture starts; that is still connecting.
      setLive(image.src || serviceUnavailable ? 'offline' : 'connecting')
    } else if (preview.frame_available === true || preview.frame) {
      setLive('live')
    }
    const frame = preview.frame
    if (frame && validSize(frame) && Number.isInteger(frame.seq) && frame.seq > frameSeq
        && typeof frame.data === 'string' && frame.data.length > 0
        && ['image/jpeg', 'image/png', 'image/webp'].includes(frame.mimeType)) {
      frameSeq = frame.seq
      serviceUnavailable = false
      root.dataset.frameSeq = String(frame.seq)
      if (!dimensions || dimensions.width !== frame.width || dimensions.height !== frame.height) {
        dimensions = { width: frame.width, height: frame.height }
        fitFrame()
      }
      image.src = `data:${frame.mimeType};base64,${frame.data}`
      image.hidden = false
      emptyState.hidden = true
      device.hidden = false
      screen.hidden = false
    }
    if (typeof preview.busy === 'boolean') root.dataset.busy = String(preview.busy)
    if (preview.busy === true) root.dataset.operating = 'true'
    if (Array.isArray(preview.events)) {
      for (const gesture of preview.events) {
        if (!Number.isInteger(gesture.id) || gesture.id <= eventId) continue
        eventId = gesture.id
        const age = (preview.server_time || Date.now()) - gesture.at
        if (Number.isFinite(age) && age >= -1000 && age <= 2500
            && (gesture.kind === 'tap' || gesture.kind === 'drag')) {
          root.dataset.operating = 'true'
          showGesture(gesture)
        }
      }
    }
  }

  function schedule(delay) {
    if (!visible() || timer) return
    timer = setTimeout(() => {
      timer = undefined
      void poll()
    }, delay)
  }

  async function poll() {
    if (!visible() || inFlight) return
    inFlight = true
    const started = performance.now()
    let nextDelay = FRAME_INTERVAL
    try {
      if (!ready) await connect()
      if (!visible()) return
      const generation = frameGeneration
      let preview
      try {
        preview = await restFetch(`/frame?after_seq=${frameSeq}&last_event_id=${eventId}`, { timeout: REQUEST_TIMEOUT })
      } catch (error) {
        // A gateway hiccup is a transport failure; the bridge answers 200 with
        // service_ready:false when the MCP server is down — that is data, not an error.
        if (error && typeof error === 'object' && error.service_ready === false) preview = error
        else throw error
      }
      if (!visible() || generation !== frameGeneration) return
      consume(preview)
      failures = 0
      nextDelay = preview?.paused || preview?.frame_available === false
        ? 1000 : Math.max(0, FRAME_INTERVAL - (performance.now() - started))
    } catch {
      failures += 1
      nextDelay = Math.min(2000, 500 * failures)
      retainFrame()
      if (failures > 1 && root.dataset.live !== 'paused' && image.src) setLive('offline')
    } finally {
      inFlight = false
      schedule(nextDelay)
    }
  }

  async function act(name) {
    if (acting || disposed || tools[name].disabled) return
    const previousEmptyState = emptyState.dataset.state
    if (name === 'refresh') {
      frameGeneration++ // Ignore a poll from before this reconnect click.
      if (!image.src) showEmpty('connecting')
    }
    acting = true
    tools[name].dataset.busy = 'true'
    syncTools()
    try {
      if (!ready) await connect()
      const data = await restFetch('/action', { method: 'POST', body: { action: name }, timeout: ACTION_TIMEOUT })
      if (!data || data.error) {
        if (name === 'refresh' && !image.src) showEmpty(previousEmptyState)
        notify(FAILED[data?.error?.code ?? ''] ?? '操作未完成，请重试', true)
      } else {
        // A refresh answers with the new stream identity; take the next frame at once.
        if (name === 'refresh') consume(data)
        notify(name === 'refresh' && data?.service_ready === false ? '未连接到手机，请确认连接后重试' : DONE[name], name === 'refresh' && data?.service_ready === false)
        if (timer) clearTimeout(timer)
        timer = undefined
        schedule(0)
      }
    } catch {
      if (name === 'refresh' && !image.src) showEmpty(previousEmptyState)
      notify('操作未完成，请重试', true)
    } finally {
      acting = false
      delete tools[name].dataset.busy
      syncTools()
    }
  }

  const toolNames = ['refresh', 'home', 'screenshot']
  const toolHandlers = []
  for (const name of toolNames) {
    const handler = () => { void act(name) }
    tools[name].addEventListener('click', handler)
    toolHandlers.push([name, handler])
  }

  function visibilityChanged() {
    root.dataset.pageVisible = String(visible())
    if (!visible()) {
      if (timer) clearTimeout(timer)
      timer = undefined
      retainFrame()
    } else {
      if (timer) clearTimeout(timer)
      timer = undefined
      schedule(0)
    }
  }

  const resizeObserver = new ResizeObserver(fitFrame)
  resizeObserver.observe(stage)
  image.onload = () => {
    if (dimensions && image.src) lastGoodFrame = { source: image.src, size: dimensions }
  }
  image.onerror = () => {
    if (disposed || root.dataset.live === 'paused' || !image.src) return
    if (lastGoodFrame && image.src !== lastGoodFrame.source) {
      image.src = lastGoodFrame.source
      dimensions = lastGoodFrame.size
      fitFrame()
    } else if (!lastGoodFrame) {
      clearFrame()
      setLive('offline')
      showEmpty('unavailable')
    }
    frameSeq = 0 // Request a replacement without blanking the last decoded frame.
    retainFrame()
  }

  const documentVisibilityChanged = () => { visibilityChanged() }
  ctx.addEventListener(document, 'visibilitychange', documentVisibilityChanged)

  function dispose() {
    if (disposed) return
    disposed = true
    ready = false
    root.dataset.pageVisible = 'false'
    if (timer) clearTimeout(timer)
    timer = undefined
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = undefined
    toast.hidden = true
    for (const [name, handler] of toolHandlers) tools[name].removeEventListener('click', handler)
    clearFrame()
    resizeObserver.disconnect()
  }

  function connect() {
    // The pane needs no handshake: the bridge is ready as soon as the MCP
    // server is, and a downed bridge simply answers service_ready:false.
    ready = true
  }

  // Initial paint.
  root.dataset.pageVisible = String(visible())
  device.hidden = screen.hidden = false
  image.hidden = true
  emptyState.hidden = false
  setLive('connecting')
  fitFrame()
  syncTools()
  connect()
  schedule(0)

  return dispose
}

function Pane(props) {
  const hostRef = useRef(null)
  // The pane renders once per plugin load; the controller owns everything inside.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !props.ctx) return undefined
    host.innerHTML = `<style>${STYLE}</style>${MARKUP}`
    const root = host.querySelector('.ips-root') ?? host
    return createController(props.ctx, root)
  }, [])
  return jsx('div', { ref: hostRef, className: 'ips-root w-full h-full', style: { background: 'transparent' } })
}

export default {
  id: 'iphone-screen',
  name: 'iPhone Screen',
  defaultEnabled: false,
  register(ctx) {
    // The controller lives outside React's render cycle (timers, DOM writes);
    // the pane div is its mount point. ctx is passed as a prop — one pane per
    // plugin load, so no shared global state.
    const removePane = ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'iPhone Screen',
      // placement:'main' + dock into the workspace's right edge = a persistent,
      // visible tile. (placement:'right' is the collapsible right sidebar's role
      // and hides the pane until "Show Right Sidebar" — not what a live mirror wants.)
      data: { placement: 'main', dock: { pane: 'workspace', pos: 'right' }, width: '340px' },
      render: () => jsx(Pane, { ctx }),
    })
    ctx.onDispose(() => removePane())
  },
}
