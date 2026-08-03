# F170 本地工作流事实审计与实施冻结

日期：2026-08-02

状态：S0 完成，实施合同冻结

## 1. 审计结论

| 工作流                  | 当前真实实现                                                                                                   | 缺口                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Open Folder             | `app/features/workspace/commands.ts` 只把 Rust picker 的 replace/add snapshot 交给 topology coordinator        | 已实现，不是 F170 缺口                              |
| Open File               | `workbench.action.files.openFile` 位于 `GUARDED_WORKSPACE_COMMAND_IDS`；vendor 通用 file dialog handler 已删除 | 完全未实现                                          |
| Recent                  | `PlainWorkspacesService` 的 add/remove/clear 是 no-op，get 固定返回空                                          | 完全未实现                                          |
| Last workspace          | `WorkspaceService::new()` 只创建进程内 `HashMap<window, scope>`，没有 app-data state                           | 完全未实现                                          |
| Settings                | configuration override 使用 `vscode-userdata:`，files override 当前为 `InMemoryFileSystemProvider`             | 可在会话内运行但不持久，且没有 Plain 产品入口       |
| Keybindings             | Workbench keybinding service 存在，但其 `keybindings.json` 与 settings 同属内存 user-data                      | 不持久，且没有 Plain 产品入口                       |
| Auto Save               | schema/`EditorAutoSave`/`FilesConfigurationService` 已在依赖中；`app/main.ts` 默认强制 `files.autoSave=off`    | 引擎存在，用户无法持久修改或验证真实写盘            |
| Untitled/Save As        | newUntitled、通用 save/duplicate command 注册已由固定 patch 移除并被 Plain guard 拒绝                          | 完全未实现；现有 backup 还只接受 `plain-workspace:` |
| New Window/Close Folder | command 被 guard；Tauri 配置只有静态 `main` 窗口                                                               | 完全未实现                                          |
| System Trash            | ADR 0004、provider capability 和 delete coordinator 都明确 permanent-only；`useTrash:true` 预副作用拒绝        | 完全未实现且需要独立威胁模型                        |

因此 F170 不能通过改文案或解除一个 command guard 完成。至少涉及 Rust local state、两个原生 picker、Workbench user-data/provider、workspace topology、untitled backup、窗口创建与平台 Trash 七条边界。

## 2. 不采用的捷径

- 不重新导入 `IFileDialogService` 或 dialogs override 根 factory；它会绕过 Rust picker 并扩大绝对路径接口。
- 不启用 Tauri 通用 fs/shell capability，不把 `file:` URI 或 canonical path 发给 WebView。
- 不用 localStorage/IndexedDB 冒充“Rust-owned persistence”；E2E 的 incognito WebView 会直接暴露这种伪持久化。
- 不让 Open File 产生隐藏 ambient file handle；首版显式采用所选文件 parent 为 workspace root。
- 不把 macOS `NSSavePanel` 返回的文件 URL 当作其父目录授权；Plain 的同目录 no-replace stage、目录 `fsync`、watcher 与后续编辑都需要目录 capability，因此文件名选择后必须再显示一次原生目录选择器，第二次结果才是最终 parent authority。
- 不把 Trash 失败回退成 permanent delete，不复用 `confirmed:boolean`，不声称操作系统 pathname API 具有 handle-relative unlink 的同等竞态保证。
- 不为了 Untitled 恢复上游通用 workspace/host lifecycle；只复用其文本模型语义。

## 3. 验收矩阵

### 自动测试

- Rust：local-state schema/migration/corruption/atomic write；recent 上限、重排、缺失 root 全批失败；picker parent 去重；settings/keybindings JSONC shape/size；untitled scratch；window isolation；Trash receipt/replay/partial/no-fallback。
- TypeScript：所有新 DTO 拒绝额外字段、Proxy/accessor、稀疏数组、非法 URI/revision；user-data provider 精确两资源；configuration/keybinding reload；Open File/Recent topology 串行；Untitled Save As 只在成功后替换；Trash coordinator 与 permanent coordinator 不串 token。
- Architecture：继续禁止 `IFileDialogService`、`file:` provider、通用 host navigation、Tauri fs/shell scope、shell/osascript Trash、`FileAtomicDelete` 和任何永久删除 fallback。
- Browser：设置跨模拟 process boundary 恢复、Auto Save 实际产生 versioned write、快捷键重载；Open File parent adoption/Recent/last restore；Untitled 取消/冲突/成功/hot-exit；新窗口 command bridge；Trash DOM cancel/confirm/partial 与 permanent 非降级对照。

### 真实 Tauri

- 原生 Open File/Save picker 不泄漏绝对路径到 WebView；冷启动恢复 last workspace，Recent 反序选择正确。
- settings/keybindings 在真实进程退出后仍生效；Auto Save 对真实 APFS 文件按配置延迟写入。
- Untitled 经 Cmd+Q 与 kill-9 恢复；macOS Save As 的文件名与父目录授权两步中任一步取消都保持 dirty/scratch 且零目标写入，显式目录授权后目标字节精确、scratch 清空。
- 新窗口拥有独立 root/dirty buffer，关闭或退出不清理另一窗口状态。
- Trash 先取消再确认：取消零磁盘副作用，确认后 Finder Trash 中可见且 workspace 原路径消失；注入/制造失败时原文件保留，永久删除 command 调用数为零。

## 4. 工作项边界

S0 只冻结事实、架构与验收，不写产品代码。后续严格按 ADR 0005 的 S1→S6 执行；若某一切片暴露新的架构歧义，先回写本文件/ADR 并提交，不并发推进下一域。
