# 交接文档：iPhone-use Hermes Live Screen 插件

> 生成于 2026-10-10。读完本文档即可接续开发，无需重查背景。
> 目标：让 Hermes Desktop 聊天窗口出现一个 **Live iPhone 镜像 pane**（对齐 Codex 版
> `zhongerxin/iPhone-use` 的右侧面板效果：实时帧流 + tap/drag 手势动画光标）。

## 1. 背景（一句话版）

用户看到 Codex 里 iPhone-use 插件的实时屏幕镜像，问为什么 Hermes 不行。
根因：Hermes Desktop **没有 MCP-Apps UI 渲染面**（已验证 `hermes_cli/` 无
mcp-app/ext-apps 引用），而 iPhone-use 的 widget 依赖 Codex 专属的
`@modelcontextprotocol/ext-apps`。方案：fork 到 GitHub（`im4saken/iPhone-use`），
加一个 loopback HTTP 帧端点 + Hermes desktop plugin pane。

**数据流（已定稿）**：
```
WDA MJPEG(USB) → MCP server 子进程 ScreenHub 帧缓存(5s lease 仲裁多客户端)
  → loopback HTTP :18199 (screen_http.py, 已写好)
  → Hermes pane 直接 fetch(同源机器, CORS:*)，每 250ms 轮询
```
注意：MCP server 是 **agent 按需 spawn 的独立子进程**（`mcp_startup.py`
background discovery），不在 gateway 内。因此 pane **直接 fetch loopback**，
gateway 侧的 `plugin_api.py` 只做兜底（读端口文件 + 服务未启动时返回
`service_ready:false`）——MCP server 没跑时 pane 显示"未连接"，
agent 一调 pua_ready 就自动上线。

## 2. 当前状态（git）

- 仓库：`~/Documents/tools/iPhone-use`
- fork：`https://github.com/im4saken/iPhone-use`（已建，origin 指向它）
- remotes：`origin`=im4saken fork，`upstream`=zhongerxin 上游
- **当前分支 `hermes`**（基于 upstream 08ed5b0 = Release 0.3.10）
- 已写未提交：`server/screen_http.py`（唯一新文件，pyright 有一个无关紧要的
  log_message 签名 lint 警告，可忽略——整个 server 都是紧凑风格）
- **尚未 commit/push**。git status 只有这一个 untracked 文件。

## 3. 已验证的关键事实（别重查）

| 项 | 值 |
|---|---|
| state_dir | `~/.local/share/iphone-use/`（`wda_setup.state_directory()`；config.json 里有 udid、local_port=18100） |
| 设备 | iPhone，UDID `00008140-000C34460CE0801C`，WDA bundle `com.andy.WebDriverAgentRunner` |
| 帧流 | `tooling/screen-stream.mjs`（node + appium-ios-device，usbmuxd 端口转发），MJPEG 经 stdout |
| ScreenHub | `server/wda_screen.py`：`frame(after_seq,last_event_id)` 返回 Preview dict（base64 JPEG + events + paused/busy/stream_id）；5s lease 自动停采 |
| Preview 字段 | `server_time, frame{seq,data,mimeType,width,height}, stream_id, device, frame_available, viewport, busy, paused, pause_reason, events[{id,kind,tap:point/drag:from+to+duration_ms,viewport}]` |
| 0.3.10 新增 | Preview 多了 `service_ready: bool`（refresh 探测 WDA /status）；UI 据此区分 connecting vs offline |
| 手势事件来源 | `PhoneController` 调 `ScreenHub.gesture()`，写 screen-state.json（10s 内有效） |
| pua_screen_action | `Runtime.screen_action(action)`：refresh/home/screenshot；screenshot 写剪贴板（macOS PNG） |
| MCP 注册 | `~/.hermes/config.yaml` L737 `mcp_servers.iphone-use`（stdio, python3, timeout 180） |
| plugins.enabled | config.yaml `plugins:` 段（agentmemory, hermes-handoff, hermes-jev…），**需追加 iphone-screen** |
| gateway 进程 | `hermes_cli.web_server`，监听 :9910/:9920；desktop plugin 的 `ctx.rest` 打到 `/api/plugins/<id>/` |
| desktop-plugins 目录 | `~/.hermes/desktop-plugins/`（当前为空；default profile） |
| Hermes 源码 | `~/.hermes/hermes-agent`（venv py3.11；SDK 文档 `website/docs/developer-guide/desktop-plugin-sdk.md`） |

## 4. 已完成

1. **fork + 分支**：im4saken/iPhone-use，本地 `hermes` 分支 @ 08ed5b0
2. **`server/screen_http.py`**（已写，~150 行）：
   - `ScreenHttpServer(state_dir, frame_fn, action_fn, port=18199)`，daemon 线程 ThreadingHTTPServer 绑 127.0.0.1
   - `GET /frame?after_seq=&last_event_id=` → `ScreenHub.frame()` 的返回（JSON）
   - `POST /action` {action} → `Runtime.screen_action()` 的返回
   - 端口写入 state_dir/`screen-http.json`（0600）；CORS `*`；stdout 是 stdio pipe，log_message 已静默
   - **待修**：`log_message(self, *args)` pyright 签名警告（改成 `self, format, *args` 或直接删掉 override）

## 5. 剩余工作（按序，含具体做法）

### 5.1 `server/iphone_use.py` 集成（~30 行改动）
- import：`from screen_http import ScreenHttpServer, DEFAULT_PORT`（文件顶部已有同类 import）
- `Runtime.__init__` 尾部：读 env `IPHONE_USE_SCREEN_HTTP`（默认 `"18199"`；`"0"`/空=禁用），
  `self.screen_http = ScreenHttpServer(self.state_dir, self.screen.frame, self.screen_action, port)`；
  **懒启动**：在 `_dispatch` 里当 name ∈ (pua_screen, pua_screen_frame, pua_screen_action) 时 `self.screen_http.start()`（放 identify_device() 旁边，L304）
- `Runtime.close()`（L568）：加 `self.screen_http.close()`
- 注意紧凑代码风格（一行多语句），别重排整个文件；只插必要行
- 端口被占时 start() 返回 False，`_publish_port` 不写文件——pane 端要能处理"无端口文件"

### 5.2 Hermes 插件包（放 repo 内 `hermes-plugin/`，安装时链接到 ~/.hermes/plugins/）
```
hermes-plugin/
├── plugin.yaml          # name: iphone-screen, version 0.3.x, description，provides_tools: []（或省略）
├── dashboard/
│   ├── manifest.json    # {"name":"iphone-screen","api":"plugin_api.py"}  （tab/entry 省略=不占 dashboard tab）
│   └── plugin_api.py    # FastAPI router（见下）
└── desktop/
    └── plugin.js        # pane 半边（见 5.3）
```
**plugin_api.py**（gateway 内运行，可 import hermes_cli；stdlib urllib 转发即可，别引 httpx）：
- `GET /frame`、`POST /action`：读 state_dir（env `IPHONE_USE_STATE_DIR` 或 `~/.local/share/iphone-use`）
  的 `screen-http.json` → urllib request 转发到 `127.0.0.1:<port>`；
  文件不存在/连接失败 → `{"frame":null,"frame_available":false,"service_ready":false,"paused":false,...}`（200，别 500）
- `GET /status`：返回 {mcp_running: bool(端口文件存在且可连)} 供 pane 判断
- 参考实现：`~/.hermes/hermes-agent/plugins/kanban/dashboard/plugin_api.py`（router 导出模式）
- **必须** `from fastapi import APIRouter; router = APIRouter()`——web_server_dashboard 只认 `router`

### 5.3 `desktop/plugin.js`（核心，~250 行）
从 `ui/src/app.ts` + `ui/index.html` + `ui/style.css` 移植，**传输层换掉**：
- import 只允许 `@hermes/plugin-sdk`、`react`、`react/jsx-runtime`（**无 npm 依赖、无构建**——直接手写 jsx()）
- `register(ctx)`：`ctx.register({id:'pane', area:'panes', title:'iPhone Screen', data:{placement:'right', width:'320px'}, render:...})`
- 组件挂载一个 root div，**innerHTML 注入 index.html 的 main#app 结构**（设备边框/按钮/灵动岛/空状态 SVG 全保留），
  style 用 `<style>` 注入但**所有选择器加前缀 `.ips-`**（原 :root/#app 等会污染整个 app），
  CSS 变量映射到主题：`--canvas:transparent; --text:var(--ui-text-primary); --muted:var(--ui-text-secondary); --line:var(--ui-stroke-secondary); --surface:var(--ui-bg-elevated)…`（dark/light 自动跟随）
- 轮询：`ctx.rest('/frame?after_seq=N&last_event_id=M')`，间隔 250ms（`ctx.setTimeout`），
  **inFlight 串行**（前一次没回来不发下一次）；失败退避 500ms×failures 上限 2s（照抄 app.ts poll()）
- consume() / setLive() / showGesture() / fitFrame() 逻辑**逐行照抄 app.ts**（L120-460），只把
  `app.callServerTool({name:'pua_screen_frame',...})` 换成 ctx.rest fetch
- 工具按钮：act() 里 `ctx.rest('/action', {method:'POST', body:{action:name}})`
- 手势动画光标：保留 Web Animations API（`marker.animate(...)`），pane 里可用
- **样式隔离是最大坑**：index.html 的 CSS 全是 `#app/#device/#screen` 裸选择器，注入前必须全量加前缀（写个构建时替换或手工 sed）
- 简化可接受：Codex 版的 glow 发光边框（glowMask/glowDots 两个函数 ~40 行）第一版可砍掉，保留设备金属边框 + 灵动岛 + 手势光标即可
- `useValue`/atom 按需；轮询状态（live/paused/offline）用局部 state + setState 即可，不用 React Query
- 页面不可见时停轮照抄（`document.hidden` → visibilityChanged）

### 5.4 安装脚本 `scripts/install-hermes.sh`
```bash
# 1. ln -sfn <repo>/hermes-plugin ~/.hermes/plugins/iphone-screen
# 2. config.yaml: plugins.enabled 追加 iphone-screen（幂等，先 grep）
# 3. mcp_servers.iphone-use 的 command/args 改指向 <repo>/server/iphone_use.py（幂等）
#    ——或保留 ~/.local 旧安装、仅提示用户二选一（推荐改指 repo，单一事实源）
# 4. 提示：⌘K → Reload desktop plugins；Capabilities→Plugins 打开 iphone-screen
```
**两个 enable 开关都要开**：config.yaml `plugins.enabled`（Python 半边）+
app 内 Capabilities→Plugins toggle（desktop 半边，defaultEnabled 默认 off）。

### 5.5 测试
1. `cd ~/Documents/tools/iPhone-use/server && python3 -c "from screen_http import ScreenHttpServer"`（import 过）
2. 起一个假 hub 测 HTTP：`python3 -c` 内联 fake frame_fn 返回固定 dict → curl `127.0.0.1:18199/frame`
3. 真机：手机 USB + WDA Runner 运行 → `python3 iphone_use.py --ready`（exit 0）→
   curl /frame 拿到 base64 JPEG → 解码看尺寸
4. desktop：⌘K Reload desktop plugins → pane 出现 → 让 agent 跑个 pua_tap 看手势光标
5. **Codex 共存**：同时开 Codex widget，确认 lease 仲裁正常（两 pane 都 live 或交替）

### 5.6 收尾
- commit（`feat: hermes live screen — loopback HTTP bridge + desktop plugin pane`）push hermes 分支
- README 加 "Hermes" 小节（fork 差异说明 + 安装命令）
- 更新 skill `iphone-use`（~/.hermes/skills/apple/iphone-use/SKILL.md）：部署路径改为 repo checkout、
  新增 "Hermes desktop pane" 一段（怎么开/排障：端口文件、lease、CORS）
- memory 更新一条：部署位置 + hermes 分支

## 6. 风险 & 已排除的坑

- **Hermes 无 MCP-Apps 渲染面** → 直接 fetch loopback，不走 ext-apps（已验证 hermes_cli 无引用）
- **renderer 读不了 0600 文件** → pane 不直接读文件，走 ctx.rest（gateway Python 进程可读）
- **MCP server 未 spawn** → plugin_api 返回 service_ready:false，pane 显示"未连接"，不报错
- **双客户端 USB 竞争** → ScreenHub 5s lease 已仲裁（Codex widget 同机制）；实测确认
- **CSS 全局污染** → 全量选择器加前缀，最大工作量点
- **stdout 是 stdio pipe** → HTTP 日志必须静默（已做）
- 上游更新合并：`git fetch upstream && git merge upstream/main`（hermes 分支只动 server/ + hermes-plugin/，冲突面小）

## 7. 开工第一句

```
读 ~/Documents/tools/iPhone-use/HANDOFF.md（本文件），从 5.1 开始继续。
```
