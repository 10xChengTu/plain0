# Plain 重写进度

更新时间：2026-07-18

## 当前状态

- 阶段：1 — Tauri 最小闭环。
- WIP：`F010` Tauri application and IPC foundation。
- 当前 Code OSS 基线：1.130.0，Electron 42.6.0，约 16,555 个跟踪文件。
- 工作树在本工作项开始时干净；SideX 与 monaco-vscode-api 的临时浅克隆均已删除且未纳入版本管理。

## 已完成

- [x] 审计 AI、账号、同步、Extension Host、编辑、搜索、终端、Git、主题和 debug 的真实依赖边界。
- [x] 调研 SideX、monaco-vscode-api、Terax、Athas、JulIDE、Lapce、Zed、Helix、GitLens、VS Code 主题格式和 Rust/Tauri 库。
- [x] 选定 Tauri/Rust 原生层 + `monaco-vscode-api` service allowlist 的迁移路线；当前完整 Code OSS 只作迁移基线。
- [x] 明确主题只读、系统 Git、通用 DAP 和不内置语言环境的产品边界。
- [x] 创建架构、范围、ADR、实施和测试文档。
- [x] 完成独立 Harness 验收并修复目标路径、工作项状态和 Git workspace trust 合同。

## 下一步

1. 核实现行 Tauri 2 与 `monaco-vscode-api` packages 的稳定版本和最小组合。
2. 搭建 Tauri 2 最小应用、允许的 Workbench service 组合、类型化 IPC 和统一检查入口。
3. 建立 service/import denylist、CSP/capability、feature evidence schema 和 browser mock。
4. 在不依赖 Electron/Extension Host 的情况下启动实际 Tauri 窗口并完成最小 E2E。

## 当前验收命令

```bash
node -e "JSON.parse(require('node:fs').readFileSync('features.json', 'utf8'))"
git diff --check
git status --short
```

Tauri 骨架完成前不运行旧 Code OSS 全量编译；它不能验证新架构。

## 已知风险

- 当前 Code OSS 1.130、`monaco-vscode-api` 对应的 Code OSS 1.128.0（upstream commit `fc3def6774c76082adf699d366f31a557ce5573f`）和 SideX 约 1.96/1.110 的接口存在漂移；旧源码只作 oracle，Rust/TS 实现都不能直接套用。
- SideX 源码审计发现路径逃逸、宽泛 Git 执行、DAP Unicode framing、watcher 无界队列、主题格式和 CSP/capability 问题；只保留失败模式和纯逻辑参考。
- Workbench 保留域仍混有 Chat/Agent 引用，必须按切片去耦后删除。
- VSIX 主题和 GitLens-like 功能有独立许可边界，第三方资源不得未经审计打包。
- macOS 的 WKWebView 不能由普通浏览器 E2E 代替，最终必须真实启动应用。

## 阻塞项

无。
