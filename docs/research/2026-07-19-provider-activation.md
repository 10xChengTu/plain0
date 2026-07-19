# Provider 写能力激活补充调研

日期：2026-07-19

## 范围与固定基线

本轮只研究 `F020` 已完成 Rust CRUD/版本化写底座之后，如何把能力安全接到当前 Workbench provider，并拆成可独立提交、可独立回滚的工作项。产品运行时仍固定为 `@codingame/monaco-vscode-* 35.0.1`，对应 Code OSS `5264f2156cbcd7aea5fd004d29eaa10209155d66`；最新 upstream 只用于发现思路，不能覆盖固定源码事实。

已核对的主要 GitHub 来源：

- Code OSS 固定版 [`FileSystemProviderCapabilities` 与 provider 接口](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/files.ts#L598-L810)，以及 [`FileService` 的 provider 注册行为](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L39-L88)。
- 固定版 [`createFile`/`writeFile`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L359-L432)、[`copy`/`move`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L766-L914) 与 [`createFolder`/`delete`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L970-L1108)。
- 固定版 Explorer [`create`/`delete` actions](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L78-L253)、[`WorkingCopyFileService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L346-L488) 和 [`BulkFileEdits`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts#L212-L283)。
- [`monaco-vscode-api` 固定源码](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/files.ts) 的 files-service override，以及同一提交的 [demo 初始化顺序](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/demo/src/setup.common.ts)；仓库当前安装态 `35.0.1` 还单独核对了 `registerCustomProvider` 的 pre-initialize registry 行为。
- 官方 [`fsprovider-sample`](https://github.com/microsoft/vscode-extension-samples/tree/main/fsprovider-sample)，只用于对照 provider 接口，不采用其 Extension Host 路线。
- Tauri/Workbench POC [`Blink`](https://github.com/bmarti44/blink)、[`@tauri-apps/plugin-fs`](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/guest-js/index.ts#L614) 与既有 [`SideX`](https://github.com/Sidenai/sidex) 调研，只用于比较接线外形和失败模式。

## 现成方案评估

### 可以复用

1. `registerCustomProvider` 正好提供 Plain 需要的单 scheme provider 注册点，而且强制 service 初始化前注册。能力 DTO 因此可以在 `main.ts` 中先读取，再一次性构造 provider；不需要运行时替换 provider。
2. Code OSS 的 `FileReadWrite`、`FileFolderCopy`、`Readonly` 和 operation event 模型可以继续作为 Workbench UI 兼容层。已完成的窄 FileService patch 可以保留非 Plain 分支原样。
3. Explorer、working-copy 与 bulk-edit 的固定调用链可以继续提供选择、dirty working copy 处理和成功后的 UI 更新，但每个会产生磁盘副作用的 Plain 分支都必须先经过专用合同。

### 不能直接采用

1. `Readonly` 是整个 provider 的粗粒度位；一旦移除，新建、重命名、copy/move、删除和保存会同时可达。不能按某一方法完成度逐项开放，也不能先开放再等待其余功能。
2. 固定 `createFile` 先 `exists` 再写，`createFolder` 使用递归 `mkdirp`。这既不是原子 no-clobber，也会替用户自动创建缺失父目录；Plain 不能直接继承。
3. 固定 copy/move 的 overwrite、预删除、自动 `mkdirp` 与 generic fallback 已由 mutation routing patch 隔离；provider 激活不得重新引入这些分支。
4. Explorer 删除确认、Trash 选择和 Bulk Undo 都是产品行为，不是调用级授权。它们允许设置跳过确认、重新计算 `useTrash`、逐项产生副作用，并可能只为小文件保留 Undo 内容；不能把它们直接映射到 Plain 永久删除。
5. 官方 fsprovider sample 依赖扩展注册与 Extension Host。Plain 明确禁止通用扩展执行，因此只能参考方法形状，不能引入其宿主、激活或 Marketplace 路径。
6. Blink 证明 Tauri 2 与 monaco-vscode-api Workbench 可以组合，但其公开说明仍是早期 POC，并直接采用通用 fs plugin、Extension Host/Marketplace 等 Plain 排除面；不能作为产品基座。
7. Tauri fs plugin 的通用 create/copy 接口面向 WebView path scope，并允许截断或覆盖语义；它不能表达 Plain 的 opaque root lease、原子 no-clobber、mutation gate 或 receipt。
8. Lapce、Zed、SideX 等编辑器拥有自己的文件模型或 ambient path 权限。它们没有可直接替换 Plain capability root、Rust receipt、版本化保存和 Workbench 调用链的模块；本轮不引入新文件系统依赖。

结论：没有满足 Plain 边界的现成整包方案。最小风险路线仍是保留固定 Workbench UI，以窄 patch 关闭不安全 fallback，由现有 Rust capability commands 成为唯一磁盘权威。

## 当前仓库事实

- `workspace_capabilities` 已严格返回并冻结 `{ create, renameNoReplace, copyMove, delete, versionedWrite }`；native bridge 和 browser mock 都只有一条调用路由。
- Rust、native bridge 与 browser mock 已实现 create、rename、copy、跨 root move、confirmed delete 和 versioned write。
- `PlainWorkspaceFileSystemProvider` 目前严格声明 `FileReadWrite | Readonly`；公共 `writeFile/mkdir/delete/rename` fail closed，尚无 `copy`。
- `main.ts` 当前在读取能力 DTO 之前构造并注册 provider。
- 版本化 existing save 已通过私有 `plainWriteFile` 接通；新文件创建不能复用这条必须携带旧 `wv1` 的路径。
- FileService copy/move/clone 路由守卫已经完成，但 create/createFolder/mkdirp 与 confirmed-delete authorization 尚未落地。
- 确认删除的真实调用链跨 `monaco-vscode-api`、bulk-edit override、base-service override、files-service override 和 Plain provider；现有受审计 patch 闭集还没有 bulk-edit/base-service 两包，不能用全局状态或 URI receipt 旁路调用级授权。

## 决策与最小提交顺序

以下顺序是依赖图，不是一个大提交。任一切片未通过自身最小验证时，不开始下一项。

1. **启动能力策略，继续只读**
   - `main.ts` 必须在 provider 构造和注册前恰好调用一次 `workspaceCapabilities()`。
   - provider factory 对能力 DTO 再做 own-data snapshot，生成窗口生命周期内不可升级的 all-five-true policy。
   - 本切片仍固定 `FileReadWrite | Readonly`，不增加任何 Workbench 写入口；unsupported/畸形/读取失败都不能产生半注册 provider。
2. **新建文件/目录路由，继续只读**
   - FileService 对 Plain `canCreateFile/createFile/createFolder/mkdirp` 增加窄分支和纵深 tripwire。
   - 新文件只接受空内容、无 overwrite，直接调用一次私有 native-create seam；目录只调用一次 provider `mkdir`。两者都不做 target stat、递归 mkdirp 或通用 write fallback。
   - provider 在 all-five-true policy 下把 URI 一次性复制为 primitive request，再分别调用一次 `workspaceCreateFile/workspaceCreateDirectory`；本切片仍不移除 `Readonly`。
3. **copy/rename/move provider 路由，继续只读**
   - `copy/rename` 严格接纳 own-data `{ overwrite: false }`，禁止额外字段和 accessor。
   - copy 只调用 `workspaceCopy`；rename 同 root 只调用 `workspaceRename`，不同 root 只调用 `workspaceMove`。
   - move 只有 `moved` 成功；retained/partial 先同步发布 source/target root rescan，再抛稳定 `WORKSPACE_MOVE_INCOMPLETE`，不得让 FileService 发 MOVE success 或重试。response 无法认证时也 rescan。
   - provider 仍不声明 `FileFolderCopy`，因此 Workbench 写入口继续不可达。
4. **confirmed-delete coordinator 与调用级授权，继续只读**
   - 落地既有 `prepare → 一次确认 → begin → 逐项 commit` 方案和固定 Workbench patch。
   - authorization 必须随当前 `ResourceFileEdit` 逐层透传并精确绑定 token、entryId、root/path/recursive/permanent；无授权的 FileService/provider delete 一律拒绝。
   - 为 bulk-edit 与 base-service override 增加两份受审计 pnpm patch，并同步扩展 patch SHA、hunk shape、lock graph 与 hostile mutation Harness；最终 patch 闭集由五包变为七包。
   - 禁止 Trash、atomic delete、Bulk Undo 内容和成功前 soft-revert；retained/partial 触发 rescan并停止余项。
5. **最终能力广告与 E2E**
   - 只有前四项和既有 versioned save 全部完成，且五个 DTO 字段全为 `true`，provider 才固定声明 `FileReadWrite | FileFolderCopy`；其他情况固定 `FileReadWrite | Readonly`。
   - 不声明 `PathCaseSensitive`、`Trash`、`FileAtomicDelete`、`FileClone`、append、unlock 或通用 atomic-write capability；`onDidChangeCapabilities` 继续 `Event.None`。
   - 浏览器 E2E 同时覆盖 all-true CRUD/save 与任一 false 的整 provider 只读降级；随后运行真实 Tauri 文件树 CRUD/save smoke。watcher/rescan 的外部变更切片仍独立排在其后。

## Harness 与验收冻结点

- bootstrap Harness 锁定 `createBridge → await workspaceCapabilities → provider factory → registerCustomProvider → initialize` 的唯一顺序和单次调用。
- provider Harness 在最终激活前继续要求 `Readonly`；每个 dormant mutation method 必须先验 all-five-true policy、一次性 URI/options snapshot、唯一 bridge 调用和清洗错误。
- fixed-patch Harness 锁定 create/createFolder 不进入 stat/mkdirp/write fallback，copy/move 继续 native-only，delete authorization 不进入扩展 API、Undo 序列化、日志或其他 scheme。
- runtime 负例至少覆盖一个 capability 为 false、DTO accessor/Proxy、URI/options sequential getter、现有目标、缺失父目录、同路径/跨 scheme/overwrite、move retained/partial/unknown、删除 token replay/错项/错 URI/options 和无授权直调。
- provider file-change 事件闭集固定为：create/createFolder/copy 成功后只发 target `ADDED`；同 root rename 与跨 root `moved` 只发 source `DELETED` + target `ADDED`；确认删除只有 `deleted` 后才发 target `DELETED`。retained/partial/响应无法认证时只同步发受影响 root `UPDATED` 再失败，不发精确成功事件；FileService 的 CREATE/COPY/MOVE/DELETE operation event 只能在 provider 成功返回后发布。既有 versioned save 继续由 FileService 发布唯一 WRITE operation event，provider 只在非成功终态发 root `UPDATED`。
- 每个实现切片先跑格式/类型/架构、相关 unit/runtime tests；最终广告切片再跑完整 `pnpm check`、browser E2E 和真实 Tauri smoke。
