# Plain 重写进度

更新时间：2026-07-19

## 当前状态

- 阶段：2 — 编辑主链。
- WIP：`F020` Workspace path policy and file tree。
- 当前最小工作项：无；`wv1`/`PLR1` 版本化读取回执切片已完成验收，下一项是 `PLW1` raw codec 与 Rust staged writer，尚未开始。
- 当前旧源码迁移 oracle：Code OSS 1.130.0，Electron 42.6.0，约 16,555 个跟踪文件；它不是 Plain 的产品运行时。
- 当前产品 Workbench 运行时基线：`monaco-vscode-api@35.0.1`，对应 Code OSS 1.128.1 commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`。
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
- [x] 完成显式跨 root move 的 GitHub/固定源码补充调研与方案冻结：对照 Code OSS 1.130/实际依赖 1.128.1、GNU coreutils 9.11、systemd、cap-std 4.0.2、rustix 1.1.4 与 RustCrypto sha2 0.10.9，确认没有 expected-inode conditional unlink 或能表达 partial 的现成方案。确定四字段 different-root command、同 gate 内 Rust-only `PublishedCopyReceipt`、publication 前 file SHA-256/raw-link 基线、发布后 source/target 双端独立重验、manifest 驱动有界 verified delete、hardlink nlink 跟踪，以及 `moved`/source-retained/source-partial 结构化非原子结果；正式 target 一旦发布绝不回滚，provider 继续只读。
- [x] 完成显式跨 root move：Rust command/service 在同一双 root mutation gate 内消费不可序列化的 publication 前 receipt，file 以 SHA-256、symlink 以 raw payload、directory 以完整 manifest/member receipt 独立重验 source 与 published target；source 只按 capability-relative 有界逆序计划删除，hardlink alias、未知成员、删除失败和双端变化返回精确 retained/partial 状态且永不回滚 target。严格 TypeScript bridge、线性 Browser mock、失败注入和 Harness 删除边界同步落地，provider 继续保持只读。
- [x] 跨 root move 切片通过完整验收：188 个 TypeScript/JavaScript 单元测试（含 48 个 Harness 边界合同）、164 个 Rust 测试、格式、类型、lint、架构/排除面 guard 与 bundle 债务基线全部通过；独立攻击审查额外修复了 target-pass source-first、observer/delete failure 分类、IPC accessor/Proxy TOCTOU、root 撤权、发布后异常收口、Browser mock O(N²)/partial-count 漂移和 observer mutation journal 优先级。
- [x] 完成确认删除的 GitHub/固定依赖补充调研与方案冻结：Code OSS 1.128.1/1.130 的十个删除链关键文件无 blob 漂移；排除 Trash 文案后静默永久删除、逐项 fallback、5 MB/空目录伪 Undo、上游 atomic/tombstone、`remove_dir_all` 与 ambient `trash` crate。确定 1..64 项 prepare/Workbench 一次确认/begin 整批预检/带调用级授权的 provider 逐项 commit、Rust-only batch receipt、统一 mutation gate 锁序、一次性 token/entryId、per-entry revalidation/journal、结构化 retained/partial 和无内容字节上限的永久删除合同；provider 继续只读且不声明 Trash/atomic capability。
- [x] 完成确认删除底层切片：Rust 实现 `prepare/cancel/begin/commit` 四阶段、窗口绑定 UUID v4、120 秒单调 idle TTL、整批 begin 预检、有序单 in-flight 消费、capability-relative nofollow 删除与精确 retained/partial 终态；目录 receipt 采用 `parent index + basename` 紧凑 manifest，hardlink/parent journal 原地重采样，未知成员流式 fail-fast。严格 TypeScript codec、native bridge 和 browser mock 同步实现，默认单调时钟、shared inode/nlink、raw symlink、生命周期失效与 observer 竞态均有回归；provider 仍保持只读，生产代码尚无删除 consumer。
- [x] 确认删除切片通过完整 `pnpm check`：238 个 TypeScript/JavaScript 单元测试、194 个 Rust 测试、格式、类型、lint、架构/排除面 guard 与 203 项 bundle 债务基线全部通过。独立复核额外修复了完整路径重复导致的超 GiB receipt 峰值、unknown-member 无界收集、hardlink/parent O(N²)、basename 往返遗漏、UUID variant/日志泄漏和 template/computed/UFCS/额外 command 参数等 Harness 绕过；10,000 alias、深链宽叶、跨 root、外部 nlink、特殊 parent sibling 与并发单消费均有验收。
- [x] 完成 opaque version、有界原子写入与 Workbench 期望版本透传的 GitHub/固定依赖补充调研和方案冻结：确认现有 model revision 链可复用，但 `mtime+size` 预检会漏等长改写、首次并发 stat/read 可配错内容基线、任意内存 buffer可与独立 stat token错配、mtime回拨会拆散权威receipt、expected token在provider前丢失且post-write resolve可再次配错token；排除Zed/Lapce/Helix的时间戳/truncate路线及通用atomic-write crate。确定保守 writer eligibility下的无状态`wv1`、tokenless readonly、同handle `PLR1` read receipt、8 MiB `PLW1` write frame、FileService五点私有receipt/bounded-stream patch、两个model各三来源baseline patch、无Retry/Overwrite错误UI、从当前root重走parent chain的staged write、带发布证据的post-rename typestate及dispatch后unknown分类；公开ancestor/stage/target最后syscall与postcheck后竞态，Windows和symlink/hardlink继续只读。
- [x] 完成 `wv1`/`PLR1` 版本化读取回执：Rust 在同一打开句柄上读取内容与前后 metadata，并从当前 root 重验 parent chain、pathname identity、filesystem gate 和 raw symlink receipt；只为通过 8 MiB、单链接、uid/gid/mode、parent 与可写 filesystem 静态 eligibility 的直接普通文件签发 root/path/Unix metadata 绑定 token，symlink、hardlink、只读和不支持平台均 tokenless。严格 `PLR1` raw frame、Tauri `ArrayBuffer`/dense `number[]` 双传输、冻结 provider receipt、FileService 单次 read-with-stat、tokenless `Readonly + ETAG_DISABLED`、TextFileEditorModel/StoredFileWorkingCopy read/buffer baseline 与 symlinkDirectory browser mock 均已接通；provider 继续保持全局只读，`PLW1` 尚未开始。
- [x] 版本化读取切片通过完整 `pnpm check`：15 个 TypeScript/JavaScript 测试文件、278 个用例、207 个 Rust 测试、格式、双 TypeScript 类型检查、严格 lint、架构/五补丁闭集 guard、前端构建及 2101-source/203-debt bundle 基线全部通过；真实 Chromium E2E 3/3 覆盖 Workbench 启动和 `ArrayBuffer`/`number[]` 两条 PLR1 transport。独立 Rust/TS/Workbench 攻击审查无剩余 P0/P1/P2；验收期间额外修复了 8 MiB descriptor 放大、symlinkDirectory 展开、共享 parent writer eligibility、TypedArray Proxy 稳定拒绝、JSON import attribute 和受审计 bounded raw symlink probe 复用。

## 下一步

1. 实现`PLW1` raw codec、Rust有界staged writer、current-root postcheck与严格post-rename typestate，接入native bridge/Browser mock；完成原生命令故障矩阵后立即独立提交，provider仍只读。
2. 实现FileService 8 MiB+1 bounded collector/write receipt、provider rescan/result seam、dispatch后unknown分类和两个save error handler的无Retry/Overwrite UI；完成package/runtime/Harness验收后立即独立提交，provider仍只读。
3. 在provider注册前读取严格`workspace_capabilities` DTO，增加copy/move同路径、overwrite、自动mkdirp、generic fallback与cross-scheme防绕过patch，并按Rust平台能力激活写能力与Browser E2E；不支持原子no-replace rename的平台继续只读。
4. 实现watcher/rescan，最后运行真实Tauri文件树总验收并写回`F020` evidence。

## 当前验收命令

```bash
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml workspace
pnpm test:e2e:browser -- workspace.spec.ts
```

## 已知风险

- 旧源码迁移 oracle Code OSS 1.130、产品运行时 `monaco-vscode-api@35.0.1` 对应的 Code OSS 1.128.1（upstream commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`）和 SideX 约 1.96/1.110 的接口存在漂移；Rust/TS 实现都不能直接套用任一旧结构。
- SideX 源码审计发现路径逃逸、宽泛 Git 执行、DAP Unicode framing、watcher 无界队列、主题格式和 CSP/capability 问题；只保留失败模式和纯逻辑参考。
- `monaco-vscode-api` 的 `missing-services.js` 仍让 bundle source map 含 203 个 Chat/Agent/MCP/Auth/Sync/Extension Runtime 债务源；运行时 guard 保证当前不可达，`F110` 必须物理清零。
- 当前排除面 guard 在 Workbench `initialize` 后审计已注册贡献；未来引入延迟 contribution 时，必须扩展为生命周期恢复后或持续审计。
- 工作区安全依赖已打开的 Rust 目录 capability；canonical path 只允许用于显示、去重与 watcher，不能退化为 `starts_with` 后调用 ambient `std::fs`。
- VSIX 主题和 GitLens-like 功能有独立许可边界，第三方资源不得未经审计打包。
- macOS 的 WKWebView 不能由普通浏览器 E2E 代替，最终必须真实启动应用。

## 阻塞项

无。
