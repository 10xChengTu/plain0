# Plain 重写进度

更新时间：2026-07-18

## 当前状态

- 阶段：2 — 编辑主链。
- WIP：`F020` Workspace path policy and file tree。
- 当前 Code OSS 基线：1.130.0，Electron 42.6.0，约 16,555 个跟踪文件。
- `monaco-vscode-api` 35.0.1 的 203 个排除域 source-map 文件仍作为已记录的迁移债务存在，但当前没有可达的排除命令、视图或 Extension Host。

## 已完成

- [x] 审计 AI、账号、同步、Extension Host、编辑、搜索、终端、Git、主题和 debug 的真实依赖边界。
- [x] 调研 SideX、monaco-vscode-api、Terax、Athas、JulIDE、Lapce、Zed、Helix、GitLens、VS Code 主题格式和 Rust/Tauri 库。
- [x] 选定 Tauri/Rust 原生层 + `monaco-vscode-api` service allowlist 的迁移路线；当前完整 Code OSS 只作迁移基线。
- [x] 明确主题只读、系统 Git、通用 DAP 和不内置语言环境的产品边界。
- [x] 创建架构、范围、ADR、实施和测试文档。
- [x] 完成独立 Harness 验收并修复目标路径、工作项状态和 Git workspace trust 合同。
- [x] 建立 Tauri 2 应用、Plain 品牌窗口、显式 CSP/capability 和版本化 command/event IPC。
- [x] 以显式 allowlist 启动模块化 Workbench，并通过四份可审计 pnpm patch 禁用 Extension Host、Accounts、Marketplace 主题浏览和 Remote tunnel 副作用。
- [x] 建立精确 Tauri 安全合同、最终 bundle 债务基线、运行时命令/视图排除面审计和 browser mock。
- [x] `pnpm check`、浏览器 E2E、Tauri debug bundle 和 macOS Computer Use 原生窗口验收通过。
- [x] 完成 Rust `workspace_stat`/`workspace_read_dir` capability reader：锁外 I/O、撤销后重验、symlink swap、目录/编码/JS 数值边界均有测试。
- [x] 完成 8 MiB 有界 `workspace_read_file`：raw bytes、增长上限、symlink/FIFO TOCTOU、错误隔离和 root 撤销均有测试。
- [x] 完成 TypeScript 文件数据 bridge 与 browser mock：严格 DTO/path/UTF-8 codec、冻结字节隔离和授权撤销语义均有测试。
- [x] 完成只读 `plain-workspace:` Workbench provider，并显式接入 files/model/explorer `35.0.1` service overrides；Rust/bridge 保持唯一 root 授权权威，URI、错误去敏、只读能力和撤销均有测试。
- [x] 审计 provider 集成后的 bundle：只新增 20 个预期的 Explorer、model 和 Plain provider source，排除域债务仍为 203，分类计数与 SHA-256 均未变化。
- [x] 完成 picker snapshot 到单目录 Workbench workspace 的首屏与动态投影；Browser E2E 从空 workspace 选择目录后展开 Explorer，并通过只读 provider 打开 README 与嵌套 TypeScript 文件。
- [x] 单目录阶段显式禁用 add-root 与 VS Code workspace trust；Git、PTY、DAP 的执行信任继续只归 Rust 管理。通用语言状态贡献使用纯空 service，不引入语言 service override。
- [x] 审计投影切片 bundle：只新增 workspace projection 与空 language-status 两个 Plain source，排除域债务数量、分类和 SHA-256 均未变化。

## 下一步

1. 依次实现新建/重命名、复制/移动和确认删除；每种可独立回滚的写语义单独提交。
2. 实现 watcher 的有界 dirty/rescan 状态机并单独提交。
3. 最后分别运行 browser mock 和真实 Tauri 文件树验收，再写回 `F020` evidence。

## 当前验收命令

```bash
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml workspace
pnpm test:e2e:browser -- workspace.spec.ts
```

## 已知风险

- 当前 Code OSS 1.130、`monaco-vscode-api` 对应的 Code OSS 1.128.0（upstream commit `fc3def6774c76082adf699d366f31a557ce5573f`）和 SideX 约 1.96/1.110 的接口存在漂移；旧源码只作 oracle，Rust/TS 实现都不能直接套用。
- SideX 源码审计发现路径逃逸、宽泛 Git 执行、DAP Unicode framing、watcher 无界队列、主题格式和 CSP/capability 问题；只保留失败模式和纯逻辑参考。
- `monaco-vscode-api` 的 `missing-services.js` 仍让 bundle source map 含 203 个 Chat/Agent/MCP/Auth/Sync/Extension Runtime 债务源；运行时 guard 保证当前不可达，`F110` 必须物理清零。
- 当前排除面 guard 在 Workbench `initialize` 后审计已注册贡献；未来引入延迟 contribution 时，必须扩展为生命周期恢复后或持续审计。
- 工作区安全依赖已打开的 Rust 目录 capability；canonical path 只允许用于显示、去重与 watcher，不能退化为 `starts_with` 后调用 ambient `std::fs`。
- VSIX 主题和 GitLens-like 功能有独立许可边界，第三方资源不得未经审计打包。
- macOS 的 WKWebView 不能由普通浏览器 E2E 代替，最终必须真实启动应用。

## 阻塞项

无。
