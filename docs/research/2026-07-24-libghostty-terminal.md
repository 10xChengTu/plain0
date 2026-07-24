# F070 终端渲染前端：libghostty 自建方案

日期：2026-07-24

## 背景与决策来源

F070 原计划接入官方 `@codingame/monaco-vscode-terminal-service-override@35.0.1` + xterm.js。实证审计（真实 Playwright 启动）确认其导入链无条件注册 8 个 Chat/Copilot-CLI/Extensions/SCM-chat 命令，触发 Plain 既有 `enforceExcludedWorkbenchSurfaces()` guard bootstrap 失败——与用户「去除所有 AI 功能」硬边界冲突，空 stub 无法阻止命令注册。**用户裁定改用 libghostty 自建终端**（不用官方 override、也不用 xterm.js）。

已提交且继续复用的地基：F070 S1（`src-tauri/src/trust/` 通用信任门 + `src-tauri/src/terminal/` Rust PTY 域：spawn/专用读线程/ack 背压/resize/kill/退出/会话上限/close_window）、S2（IPC 桥接骨架：命令闭集、事件、codec、browser mock）。本方案替换的是「谁解析 VT + 怎么渲染」这一层，PTY 字节获取与 trust 门不变。

## 双路调研结论（均带链接核实，2026-07-24）

### VT 核心

- `libghostty-vt`：Ghostty 从生产代码抽出的独立 headless 库，零依赖 C ABI（不需 libc），MIT。提供三组能力：**终端状态**、**面向自定义渲染器的增量 Render State**（全局 dirty 枚举 `GHOSTTY_RENDER_STATE_DIRTY_{FALSE,PARTIAL,FULL}` + 逐行脏位 + 逐 cell 迭代器输出 grapheme/style/fg/bg/selected）、**输入编码**（key/mouse/focus，含 Kitty Keyboard Protocol）。明确不含渲染。
- 活跃 Rust binding：`libghostty-vt` crate（对 `libghostty-vt-sys` 的 safe wrapper，v0.2.x，MIT/Apache-2.0，`Terminal`/`RenderState` 等类型）。
- **成熟度诚实标注**：libghostty-vt 与其 Rust binding 均 **pre-1.0，API 明确会有破坏性变更**；binding 声明**非线程安全**（反映底层 C API 约束）。
- 构建：`libghostty-vt-sys` 的 build.rs shell out `zig build`，要求 **Zig 0.15.x**（本机已装 0.15.2 ✓）；默认联网拉取 pinned Ghostty 源码，可用 `GHOSTTY_SOURCE_DIR` 指向本地 checkout 做离线/可复现构建（**本方案要求锁定本地源、禁止 `cargo build` 期不可控联网**）；默认静态链接。

### 渲染层

- **不复用 xterm.js 渲染器**：其 parser/renderer 耦合，无公开「喂自定义 buffer」路径，xterm.js 团队自身仍在讨论重构（issue #5686），fork 改造风险不可控。
- 首选（性能路线）：**beamterm**（Rust 原生 + WASM/WebGL2 双目标同源，MIT，<1ms/45k cells，已处理 Unicode grapheme/CJK/emoji 双宽；cell 结构 char+style+fg/bg 与 libghostty-vt render-state 输出高度接近）。定位是「纯渲染器，终端逻辑你提供」。不含 scrollback（留调用方）。
- 备选（MVP 简单路线）：**wterm 的 DOM 渲染**（脏行 + innerHTML 批量 + CSS 变量），性能上限低但换来**原生文本选择/Cmd+F 查找/无障碍**（canvas/WebGL 需自实现这些）。
- **原生 surface 叠加路线否决为首选**：macOS 需手工几何同步、Linux 需 X11/Wayland 两套（wry `build_as_child` 仅 X11），与「终端是随分栏/拖拽移动的 DOM 面板」根本冲突；生态唯一相近成功案例（Steam 覆盖层）耗时约一年半且不含 Linux。留作长期性能兜底，非首选。

### 同步协议与输入

- 增量同步不自研：采用 libghostty-vt 内建 Render State 语义（dirty 枚举 + 逐行脏位 + 逐 cell 迭代器）。Rust 每次 PTY 读批次后 `feed` + render-state update，只序列化 dirty 行经 Tauri event（复用 base64 二进制先例）推给 WebView，rAF 内合并渲染；resize 触发 FULL dirty 直接整帧重传。**scrollback 留 Rust 侧，WebView 按需 command 拉可视窗口外的行**（wterm/beamterm/libghostty-vt 三方共识）。
- 输入不自研：libghostty-vt 自带 key/mouse/focus 编码器（Rust 侧调用），WebView 捕获 DOM `KeyboardEvent` → command → Rust 编码 → 写 PTY。唯一需 DOM 层自处理的是 **IME 组合输入**（`compositionstart/update/end`，组合中间态不发给 key encoder）。

## 技术方案（分阶段、spike 先行降风险）

### 决策 A：VT 核心 = libghostty-vt（Rust FFI），退路已定

- Rust 侧引入 `libghostty-vt` crate（精确锁版本 + 锁 Ghostty 源 commit + `GHOSTTY_SOURCE_DIR` 离线构建）；Zig 0.15.x 作为构建期依赖记入供应链文档与 Harness 依赖记录。
- **退路（写进方案，spike 判定后决定是否启用）**：若 spike 证明 libghostty-vt/binding 太不稳定或无法可复现构建，切换到纯 Rust 的 `alacritty_terminal`（Apache-2.0，完整网格/scrollback）或 `vte`（解析器，2500+ 反向依赖）——零 FFI、零 Zig，渲染层与同步协议设计不变。此退路不改变整体架构。

### 决策 B：渲染层分两步落地

- **MVP：DOM 渲染**（wterm 风格），先跑通端到端管线并白得原生选择/查找/无障碍；
- **优化：按需升级到 beamterm/WebGL**（仅当 DOM 在高吞吐下性能不足，用真实压测数据触发，不预先投入 WASM/WebGL 工具链）。

### 决策 C：复用 S1/S2 地基

- S1 PTY 读线程的字节不再原样发前端，而是先 `feed` 进 libghostty-vt；S2 的 `terminal-data` 事件语义从「原始字节」改为「render-state dirty 行 payload」；会话生命周期、ack 背压、事件 Harness 脚手架、trust 门全部沿用。

### 切片拆分

1. **SP spike（go/no-go 门）**：Rust 加 `libghostty-vt` crate + 锁定本地 Ghostty 源离线构建，FFI 一个 `Terminal`，`feed` 若干字节，读回 render-state cells，Rust 测试断言网格内容；确认 `cargo test` 与 `pnpm check` 在 Zig 依赖下仍可复现构建、无不可控联网。**不碰前端**。失败→启用决策 A 退路并报告。
2. **VT 集成**：libghostty-vt 接入 terminal 域——PTY 字节→feed→render-state；暴露网格快照 + dirty 行序列化 + 输入编码（key/mouse/focus）；全套 Rust 测试。
3. **IPC 改造**：S2 原始字节 data 事件改为 render-state dirty 行事件 + 输入命令；codec + browser mock；单元全套。
4. **WebView 渲染（DOM MVP）+ trust UX**：自建终端视图（Panel）渲染 dirty 行、键盘→输入管线、IME 处理、trust 确认对话框；Browser E2E（打开/回显/resize/关闭/未信任禁用）。
5. **多 tab/split + 生命周期 + scrollback**：tabs/splits、scrollback 按需拉取、窗口关闭清理；Browser E2E。
6. **压测/背压 + 可选 WebGL 升级 + 收口**：高吞吐背压/分片证据、（可选）beamterm/WebGL、E2E-007 交接、evidence 闭环切 F080。

## 风险与诚实评估

- 两层 pre-1.0（libghostty-vt + binding）+ Zig 构建期依赖 + 从零渲染集成 + IME，整体工作量显著大于原 xterm/patch 路线，是多切片的实打实工程。
- spike 先行是本方案的风险闸门：先用最小代价证明「Zig 离线构建 + FFI + 拿到网格一帧」可行，再投入全量；退路（alacritty_terminal/vte）随时可切且不改架构。
- 不做：会话持久化/重连、shell integration（OSC 133/633）、Windows（留 F120）、连字（首版）。
