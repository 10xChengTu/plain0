# Plain 重写进度

更新时间：2026-07-18

## 当前状态

- 阶段：2 — 编辑主链。
- WIP：`F020` Workspace path policy and file tree。
- 当前最小工作项：暂无；有界目录 manifest/staged tree copy 已完成，下一项为显式跨 root move 的补充调研与方案冻结。
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
- [x] 完成 F020 CRUD 写语义补充调研与方案冻结：各写语义、最小安全保存与平台写能力激活分成独立提交；写入与授权撤销使用统一 mutation gate 线性化；原子 no-clobber 不允许检查后普通 rename fallback。
- [x] 完成空文件与单级目录的原子 no-clobber 创建：Rust capability command、每窗口 mutation gate、严格 TypeScript bridge 和每实例 browser mock 均已接通；root replace/remove/window close 与写入线性化，关闭单窗口不会阻塞其他窗口。provider 继续保持只读。
- [x] 创建切片通过完整 `pnpm check`：85 个 TypeScript 测试、76 个 Rust 测试、架构/排除面 guard 与 bundle 债务基线全部通过；Tauri `Result<(), CommandError>` 成功响应另有 JSON `null` 合同测试。
- [x] 完成同 root 原子 no-clobber 重命名：父目录先由 `cap_std` 打开为 capability，同父目录复用句柄，macOS/Linux 只对 basename 调用固定 `rustix 1.1.4` `NOREPLACE`；其他平台和不支持的文件系统安全失败，不存在普通 rename fallback。严格 Rust/TypeScript DTO、native bridge、每实例 browser mock、mutation gate 竞态与 Harness 边界 guard 均已覆盖，provider 继续保持只读。
- [x] 重命名切片通过完整 `pnpm check`：90 个 TypeScript 测试、91 个 Rust 测试、架构/排除面 guard 与 bundle 债务基线全部通过。
- [x] 完成 capability copy 的 GitHub 补充调研与方案冻结：排除会覆盖目标的 `Dir::copy`/`std::fs::copy`、无界且可留半成品的 VS Code fallback，以及 ambient/overwrite 导向的第三方整包方案；确定双 root、无 overwrite、普通文件 8 MiB staged copy 先行，目录 manifest 与原样 symlink copy 后续独立提交，provider 期间继续只读。
- [x] 完成双 root、8 MiB、仅普通文件的 staged no-clobber copy：四字段严格 IPC、双 lease mutation gate、末级 nofollow/nonblock、16 次有界高熵 staging、基础权限与 `sync_all`、第二遍 source-handle/staging 内容复核、identity 清理和 `NOREPLACE` 发布均已落地；目录、symlink、特殊文件与不支持平台安全拒绝，provider 继续保持只读。
- [x] 普通文件 copy 切片通过完整 `pnpm check`：110 个 TypeScript/JavaScript 单元测试（含 24 个 Harness 边界合同）、110 个 Rust 测试、架构/排除面 guard 与 bundle 债务基线全部通过；测试覆盖跨 root、8 MiB + 1、source 等长改写、basename/parent/staging swap、现有目标各类型、双 root 撤销和并发单胜者。
- [x] 完成原样 symlink staged no-clobber copy：固定 4 KiB + 1 原始字节探针，不解引用内部、外部、dangling、loop、absolute 与非 UTF-8 payload；source/stage identity、metadata 与 payload 在发布和安全清理前复核，16 次高熵 `symlinkat` staging 后复用 `NOREPLACE`，目录与特殊文件仍拒绝，provider 继续只读。Browser mock 按复制后位置动态重算 `symlinkFile`/`symlinkDirectory`，不把解析结果误当成链接固有类型。
- [x] symlink copy 切片通过完整 `pnpm check`：116 个 TypeScript/JavaScript 单元测试（含 26 个 Harness 边界合同）、117 个 Rust 测试、架构/排除面 guard 与 bundle 债务基线全部通过；测试覆盖 raw 非 UTF-8 payload、4 KiB + 1、跨 root 动态分类、source/stage/parent swap、现有目标各类型、双 root 撤销、并发单胜者和 dangling link 目录项不存在语义。
- [x] 完成有界目录 copy 的 GitHub/固定依赖补充调研与方案冻结：排除 `remove_dir_all`、第三方 walker 和 Code OSS 边遍历边创建 fallback；明确 source-first manifest、descendant 精确预算、target-parent directory identity 冲突、0700 staged tree、发布前 source/stage 双重验收、receipt-only 有界清理、目录 mode 收尾和外部竞态边界。现有四字段 command、双 root mutation gate 与只读 provider 保持不变。
- [x] 完成有界目录 manifest/staged tree copy：Rust 以显式 DFS 建立并重验完整 source manifest，执行 10,000 条目、1 KiB 单名、2 MiB 名称、256 层、4 KiB/2 MiB symlink、8 MiB/256 MiB 文件预算；目录逐层 nofollow，raw symlink 原样复制，特殊文件拒绝。目标树在 0700 高熵 staging 中按 identity/payload receipt 构建，所有测试竞态窗口结束后再次精确核对成员、文件字节、raw link 与 source manifest，再应用目录 mode 并仅用 `NOREPLACE` 发布；未知或 replacement 成员只安全遗留，不做无界递归删除。Browser mock 同步实现有界 detached tree 和跨 root 语义，provider 继续只读。
- [x] 目录 copy 切片通过完整局部验收：134 个 TypeScript/JavaScript 单元测试（含 39 个 Harness 边界合同）、144 个 Rust 测试、格式、类型、lint 与架构 guard 均通过；独立审查额外复现并修复了最终 member-set 后新增未知成员、同 inode staged file 改写、staged symlink 替换和嵌套 source 变化的发布窗口。

## 下一步

1. 先对显式跨 root move（copy receipt + verified delete）和确认删除做 GitHub/固定依赖补充调研与方案冻结，再分别落地并单独提交；期间 provider 保持只读。
2. 全部 CRUD 后先实现 opaque version、有界原子写入和 Workbench 期望版本透传，再在 provider 注册前读取严格 `workspace_capabilities` DTO，增加 copy 同路径/overwrite/自动 mkdirp/cross-scheme 防绕过 patch，并按 Rust 平台能力激活写能力与 Browser E2E；不支持原子 no-replace rename 的平台继续只读。随后实现 watcher/rescan，最后运行真实 Tauri 文件树总验收并写回 `F020` evidence。

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
