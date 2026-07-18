# ADR 0001：Tauri + 模块化 Code OSS Workbench

- 状态：接受
- 日期：2026-07-18

## 背景

目标是把当前 Electron Code OSS 变成 Tauri/Rust 轻量编辑器，同时保留 VS Code 级文件、编辑、搜索、终端、Git、主题和调试行为。Tauri 使用 Rust 后端和系统 WebView；它不要求 UI 也用 Rust 重写。

四条候选路线：

1. 继续维护并裁剪当前 Code OSS `src/vs`。
2. 直接以 SideX 源码为产品基线。
3. 按需组合 `@codingame/monaco-vscode-api` service overrides，自建 Plain composition 与 Rust services。
4. 从空白 React+Monaco/CodeMirror 重建全部 Workbench。

源码审计显示：当前 `src/vs` 约 8,750 个文件，直接裁剪会长期维护一个高耦合下游分叉；SideX 缺少可可靠 rebase 的 upstream commit，源码/产品标记约处于 Code OSS 1.96–1.110 时代，仍带 Extension Host/LSP/Remote/Auth 且 debugger 未完成；空白 UI 会重复实现标签、布局、命令、快捷键、数据防丢、SCM、DAP 和可访问性。`monaco-vscode-api` 在调研日跟随 Code OSS 1.128.0（commit `fc3def6774c76082adf699d366f31a557ce5573f`），并把 Workbench 能力拆成可独立安装的 packages。

## 决策

选择路线 3：

- WebView 通过显式 allowlist 组合 Workbench、Views、Editor、Theme/TextMate、Files、Search、Terminal、SCM 和 Debug service overrides。
- Plain 自己拥有 TypeScript feature composition、IPC DTO 和 Rust service contract。
- Tauri 替换 Electron lifecycle/window/menu/IPC/build。
- Rust 替换 Node/Electron 的 fs/search/PTY/Git/DAP/theme/storage。
- 不导入 AI、Chat、Auth、Sync、Gallery、Remote、Task、Testing、Notebook 或 Extension Host packages。
- 当前 Code OSS 源码只在迁移期作为行为、静态资源和测试基线，最终删除。

主题 contribution registry 可以作为内部声明解析机制，但不会创建 local、worker、WASM 或 sidecar Extension Host。

SideX 只作为 MIT Rust donor/reference；每个借鉴模块重新审计并按 Plain 合同重写，不能直接覆盖仓库。

## 结果

优点：

- 保留成熟编辑/Workbench 行为，同时避免维护数千个上游源码文件。
- service package 可按产品范围组合和升级，禁止面可以由 import/lockfile 检查强制执行。
- 不捆绑 Chromium/Node runtime，原生权限集中在 Rust。

代价：

- 依赖第三方打包的 VS Code 内部 service，升级必须做合同和 bundle 审计。
- 仍需实现 Rust-backed filesystem/terminal/search/SCM/debug adapters。
- WebView 在不同平台有差异，必须做真实 Tauri 验收。

## 被拒绝方案

- 直接裁当前 Code OSS：最高兼容但迁移和长期升级成本不可控。
- 整仓采用 SideX/Athas/Terax：成熟度、AI/扩展/许可或版本范围冲突。
- 全新 React/CodeMirror/Monaco 壳：无法在合理范围内达到所需 Workbench 行为。
- 继续 Electron，只把少量服务换成 Rust：不满足 Tauri 重写和轻量目标。
