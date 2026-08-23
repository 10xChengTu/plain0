# Plain 总体架构

状态：初始技术方案
更新时间：2026-07-18

## 1. 决策摘要

Plain 采用“模块化 Workbench + Rust 原生服务”的重写方式：

- WebView 只按需组合 `@codingame/monaco-vscode-api` 的 Workbench、Editor、Views、Theme/TextMate、Files、Search、Terminal、SCM 和 Debug service overrides。
- 当前仓库的 Code OSS `src/vs`、`extensions` 和测试仅在迁移期充当行为、静态资产和合同来源，最终不维护一套大型下游源码分叉。
- Tauri 2 管理窗口、菜单、生命周期、IPC 和打包。
- Rust 实现 workspace、文件监听、搜索、PTY、Git、DAP、主题包与本地存储。
- 主题是唯一允许导入的 VS Code extension contribution，而且只按静态数据处理；不会创建任何 Extension Host。

SideX 证明 VS Code Workbench 可以运行在 Tauri WebView 中，但其来源没有记录可可靠 rebase 的 upstream commit，源码/产品标记约处于 Code OSS 1.96–1.110 时代，已经落后于仓库内仅作迁移 oracle 的 Code OSS 1.130；它仍带 LSP、Remote、Auth、通用扩展扫描和高风险权限。Plain 只借鉴经过重新审计的 Rust 实现思路。产品 Workbench 运行时固定为 `monaco-vscode-api@35.0.1`，对应 Code OSS 1.128.1（commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`），并把功能拆成独立包，更适合作为可升级产品主体。

## 2. 进程模型

```text
┌──────────────────── Tauri application ────────────────────┐
│ Rust main process                                           │
│ ├─ window/menu/lifecycle                                    │
│ ├─ workspace + fs + watcher                                 │
│ ├─ in-process search (grep-searcher, bounded DFS)           │
│ ├─ PTY sessions                                             │
│ ├─ Git command service                                      │
│ ├─ DAP adapter processes / TCP sessions                     │
│ ├─ theme package importer                                   │
│ └─ local settings/session store                             │
│            │ typed commands + bounded events                │
│            ▼                                                │
│ System WebView                                              │
│ ├─ selected Monaco/Workbench service overrides              │
│ ├─ Plain explorer/search/Git Insights/debug composition     │
│ ├─ static theme contribution registry                       │
│ └─ xterm.js                                                 │
└─────────────────────────────────────────────────────────────┘

External local processes: system git, user-configured DAP adapter, and
shells. Search runs in-process (no ripgrep sidecar or other external
search process — see section 6).
```

不会存在 Electron、Node runtime、共享进程、local/worker/WASM/sidecar Extension Host、AI service 或账号 service。

## 3. 目标目录

```text
app/
├─ main.ts                       # WebView/Workbench composition entry
├─ services.ts                   # explicit service override allowlist
├─ contributions.ts              # explicit UI contribution allowlist
├─ platform/
│  └─ tauri/                     # sole typed IPC adapter layer
├─ features/
│  ├─ explorer/
│  ├─ search/
│  ├─ terminal/
│  ├─ scm/
│  ├─ git-insights/
│  ├─ debug/
│  └─ themes/
└─ styles/
src-tauri/
├─ Cargo.toml
├─ capabilities/                 # minimum permission declarations
└─ src/
   ├─ app.rs                     # Tauri setup/registration
   ├─ error.rs                   # stable serializable error contract
   ├─ path_policy.rs             # workspace boundary/canonicalization
   ├─ workspace/
   ├─ search/
   ├─ terminal/
   ├─ git/
   ├─ debug/
   ├─ theme/
   └─ settings/
resources/
├─ grammars/                     # audited static TextMate grammars
├─ themes/                       # redistributable built-in themes
└─ icons/
tests/
├─ browser/                      # Workbench E2E with mock IPC
├─ fixtures/                     # workspace/theme/git/DAP fixtures
└─ native/                       # real Tauri acceptance drivers
```

迁移期间旧 Code OSS 目录与 `app/` 会短暂共存。Git 历史负责追溯，不保留隐藏的 legacy 副本。

## 4. 前端组合白名单

允许的 service 类别：

- base/host/lifecycle/environment/log/storage/configuration/keybindings。
- workbench/views/titlebar/statusbar/banner/editor/model/working-copy。
- files/explorer/quick-access/search。
- theme/textmate/静态默认 grammar packages。
- terminal/SCM/debug/markers/output/dialogs/notifications/accessibility。

明确禁止：

- AI、Chat、MCP、Speech/Agents。
- Authentication、Secret/Account entitlement、User Data Sync/Edit Sessions。
- Extension Gallery、Remote Agent、Share、Update、Survey/Assignment/Telemetry。
- Task、Testing、Notebook、Interactive、LSP 或语言 feature extensions。
- 任何 `vscode/localExtensionHost`、extension worker、WASM runtime 或外部 Extension Host。

`@codingame/monaco-vscode-api` 35.0.1 的 `initialize()` 会无条件组合 extensions service，API 包本身也对它有传递依赖。因此 lockfile 中允许这个精确的惰性 registry 依赖，但 `app/` 不得直接导入 extensions service override。默认的 worker host 必须保持关闭；不得出现 `vscode/localExtensionHost`、`extensionHost.worker`、`ExtensionHostKind`、`setLocalExtensionHost` 或 `enableWorkerExtensionHost: true`。

对话框只从同版 `@codingame/monaco-vscode-dialogs-service-override` 的公开导出子路径加载官方 `DialogService` 与 `dialog.web.contribution`，并只为 `IDialogService` 构造 descriptor，使用 VS Code `BrowserDialogHandler` 在 Workbench DOM 中异步渲染。禁止导入或 spread 包根工厂：它还会把 `IFileDialogService` 及约 89 KB 未压缩文件对话框实现带入 bundle，完整 spread 更会绕开 Plain 的 Rust picker/文件边界；也禁止以对话框为由增加 `dialog:*` Tauri capability 或回退到全局 `window.confirm`。

构建必须有架构检查：扫描 `package.json`、lockfile、`app/` import 和最终 worker 产物，禁止上述执行入口及其他排除包。主题 manifest 可通过 extension contribution registry 注册，但 registry 只收到 Rust 导入器产生的白名单静态描述，不启动 host。

## 5. 依赖方向

```text
DTO/types → path/security → Rust domain service → Tauri command adapter
      ↑                                             ↓
Workbench model ← Plain feature service ← typed bridge/events
```

- Rust 域模块不能依赖 WebView 细节。
- Workbench feature 不能直接调用 `invoke()`；必须经过 `app/platform/tauri`。
- UI 不能传入任意命令行字符串；Rust 根据结构化请求构造参数数组。
- command 不直接返回无限列表或无限字节；搜索、PTY、Git log 和 DAP 使用分页/有界事件流。
- 第三方 service override 的内部类型不能穿过 IPC；IPC DTO 由 Plain 自己拥有。

## 6. 域设计

### Workspace 与文件

- 一个窗口拥有一个独立 workspace scope；它包含一个或多个只经 Rust 原生目录选择器授权的 root，并为每个 root 分配稳定 opaque id。目录选择只授予文件访问，不等于授予 Git、PTY 或 DAP 外部进程执行信任。
- hot-exit backup 按 Rust 内部稳定的**单 root**身份分区，而不是按当前整组 roots 或随机 rootId 分区；每次 write/read/discard 都显式携带当前授权 rootId，Rust 将它映射到对应的稳定存储目录，read 再只返回该目录当前会话的 rootId。因此同路径文件跨根不碰撞，重启后 capability UUID 轮换以及 root 增删/重排都不需要前端猜测。旧版单根 root-set 目录只作为可精确映射的兼容读取源；旧版多根集合目录因没有成员归属信息而 fail closed。
- 原生关闭采用 Rust/WebView 双阶段握手，不依赖 `beforeunload`：窗口 `CloseRequested` 与应用 `ExitRequested` 首次都由 `CloseCoordinator` 阻止并发出绑定窗口、原因、UUID-v4 与 5 秒前端预算的事件；Workbench 只有在普通 veto、最终 working-copy backup 刷新、storage flush 与有界 will-shutdown joiner 全部完成后才回一次性 allow。Plain 明确把 `window.confirmBeforeClose` 默认钉为 `never`，不允许 WebView 的 `keyboardOnly` 通用确认在这条原生序列前重复 veto；数据丢失确认仍属于普通/最终 veto。原生请求额外保留 3 秒 IPC 回执余量；错窗口、错 id、重放、过期、事件发送失败、backup/storage 异常或前端超时全部保持窗口存活。最终 backup 以 working-copy content version 做稳定性重验，持续编辑超过有限重试则 veto，不能以旧的节流快照换取关窗。
- Workbench 的 1..256 个 folders 只由完整 Rust `WorkspaceSnapshot` 投影：真实文件继续使用 `plain-workspace://<rootId>/`，生成配置固定为只读、eventless 的 `plain-workspace-config://<workspaceId>/workspace.code-workspace`，JSON 只含有序 `folders[].{uri,name}`。零 root 清除旧配置并回到 EMPTY；生成配置不使用 `file:`、绝对路径、`transient`、settings/tasks/launch 或可写内存文件。固定 configuration patch 让两个 Plain scheme 都绕过异步 cache。
- 单一 topology coordinator 以 FIFO 串行 native root mutation、install/clear 与 `reinitializeWorkspace`，保持 workspaceId、强制 revision 单调并拒绝同 revision 异内容。mutation callback reject 时必须在队列内读取权威 Rust snapshot：未变则透传错误，已更新则先收敛再透传，不可判定则锁死。只有经过 workspaceId/revision/topology 校验并成功投影的最终 snapshot，才能在 `reinitializeWorkspace` dispatch 前同步更新每个 bridge 的前端 watcher root authority；manager 初始为空授权，迟到、stale、同 revision 冲突或仅被 bridge 解码的响应不得产生撤权副作用，零 root 必须取消订阅、清 timer 并解绑 wake listener。每次 reinitialize resolve 后必须从 `IWorkspaceContextService` 核对实际采用的 id、configPath 与有序 root URI；核对成功后再切换 Rust-owned Workbench layout 分区，分区刷新失败同样进入 outcome-unknown reload boundary，不能把旧 workspace 的布局附着到新 roots。只有 dispatch 前的配置准备失败允许重取一次 Rust snapshot。`reinitializeWorkspace` reject 可能已经部分更新 Workbench，必须按 outcome unknown 立即锁死、要求重载，禁止 retry、反向 root mutation、回滚已经接受的 watcher authority 或宣称成功。
- Workbench storage 仍保持同步 API，但只把审计过的 layout/view-arrangement key 交给 Rust：profile 分区保存全局尺寸、固定栏位和 pinned/placeholder arrangement；workspace 分区保存可见性、位置、active container 与各 view state，并按 Rust `WorkspaceRootsIdentity` 的稳定 root-set digest 命名。启动先读取严格有界快照，再把 `PlainLayoutStorageService` 注入 `initialize()`；Workbench 构造完成后对非 EMPTY workspace 再投影同一快照，覆盖 vendor built-mode 把非默认 Sidebar active container 强制改回 Explorer 的启动行为。其余历史、认证、编辑内容和任意 storage key 只留在内存且永不跨 IPC。Primary Side Bar 左右位置不再读取或写入上游全局 `workbench.sideBar.location`：固定 vendor patch 让布局命令直接更新 runtime state 与 Plain 专用 context key，冷启动只采用当前 root-set 的 workspace entry 或左侧默认值。`reinitializeWorkspace()` 只更新配置与 folder context，不会重建已存在的 layout/view runtime；因此 topology adoption 后的分区切换还必须把新 workspace 快照显式投影到现有 part visibility、position 与 pane active-container，空分区使用固定的左侧 Explorer、隐藏 panel 默认值，避免 live root-set 继承上一分区。空 workspace 不读写 workspace entries；正常原生 close 的 `IStorageService.flush(SHUTDOWN)` 触发 Workbench 最终 state save，并在 lifecycle allow 前等待 Rust 原子发布完成。损坏 JSON 隔离为 quarantine，WebView 不接收 app-data 路径或 identity digest。
- 默认 `IWorkspaceEditingService` 与 `IWorkspacesService` 由 Plain fail-closed/no-recent 实现覆盖；通用 Open File/Workspace、Host/FileDialog、untitled、save/duplicate/close/new-window command 注册从固定 patch 移除，direct command id 再稳定拒绝。replace/add/remove 只能由 Plain product command 调用 Rust picker/scope mutation并消费返回的完整 snapshot。
- F170 的本地工作流按 ADR 0005 逐项替换上述 fail-closed 占位，而不恢复通用 service：Rust 私有 recent/last-workspace 记录只从曾经明确授权的 canonical roots 重开 capability，IPC 只给 opaque recent id 与显示标签；Open File 由原生 picker 选择后把 parent 显式加入 workspace root，再用 `plain-workspace:` 打开，不建立隐藏 `file:` provider。`vscode-userdata:` 只允许 `/User/settings.json` 与 `/User/keybindings.json` 两个有界 JSONC 资源并由 Rust 原子持久化；Untitled recovery 使用独立 Rust scratch id/分区，`IWorkingCopyBackupService` 只把严格的 `untitled://<scratch-id>/Untitled-<digits>` 资源路由到 scratch，普通 `untitled:` 与所有 workspace backup key 都不能进入该分区。Save As picker 只返回授权后的 `{rootId,relativePath,existingStat}`。新目标字节经独立 `PLN1` raw frame、capability-relative create-new stage 与 `renameat_with(NOREPLACE)` 发布，已存在目标只允许带当前 version receipt 的后续 versioned write，任何取消、冲突或不完整发布都不能先删除 scratch；New Window 只能创建固定 Plain 应用入口。各切片落地前相应入口继续 fail closed。
- 当前 `app/` 生产源码禁止动态 `import()`，配置 provider/factory 与 `CommandsRegistry` 的导入、注册和 guarded id 也由全 app authority Harness 锁成固定闭集；在建立可持续核对当前 handler/provider 身份的生命周期 guard 前，不允许用晚到模块重新开放这些入口。
- 每个 root 在 Rust 中持有已打开的 `cap_std::fs::Dir` capability；canonical path 是仅供显示、文件身份去重和 watcher 使用的私有元数据，不是 I/O 授权依据。
- 所有路径请求采用 `(rootId, relativePath)` 或经过授权的 opaque handle。wire path 固定使用 `/`，拒绝 absolute、prefix、`.`、`..`、NUL、空组件和平台歧义；WebView 不接收或提交原生绝对路径。
- 读取与 CRUD 必须相对 root capability 执行，禁止先 `canonicalize`/`starts_with` 再用 ambient `std::fs`。跨 root 操作必须显式携带两个已授权 root；普通 rename 默认不覆盖。
- 目录 copy 在任何目标副作用前建立并重验 capability-relative manifest；固定条目、名称、深度、symlink 与逻辑文件字节预算，逐层 `open_dir_nofollow`，特殊文件拒绝。目标父目录不得落入 source directory identity 集合；完整 staged tree 经 receipt 重验后只用原子 no-replace 发布，失败清理不得使用无界递归 helper。
- 跨 root move 在同一次双 root mutation gate 内消费 Rust-only `PublishedCopyReceipt`：普通文件由 publication 前稳定 source/staged target 双侧确认的 SHA-256 digest 绑定，symlink 保存完整 raw payload；正式 target 发布后先分别重验当前 source 与 published target，再以 manifest 驱动的有界逆序 `remove_file/remove_dir` 删除 source。发布后禁止回滚 target；source 零删除或部分删除必须返回结构化非原子状态。没有 expected-inode conditional unlink 或跨文件系统事务，因此 source 最后 identity 检查与删除之间、target 最后验收与 source 删除之间的同 UID 竞态都是公开边界，不能宣称跨进程原子。
- 永久删除由 Plain 批量 coordinator 统一执行 prepare → Workbench 一次确认 → begin 整批预检 → provider 逐项 commit：Rust-only `DeleteBatchReceipt` 绑定 1..64 个非重叠顶层 namespace entry、一次性 token/entryId、窗口/root/path/options 和有界 manifest。固定 Workbench patch 把调用级 authorization 从 `ResourceFileEdit` 透传到同一 Plain provider；缺少授权的 FileService delete fail closed。所有 batch 操作使用 `mutation gate → state`、严格顺序和单 in-flight，每项删除前再次重验；只按固定计划用 parent capability + basename 逆序 `remove_file/remove_dir`，retained/partial 必须结构化报告并停止余项。删除 receipt 不读取普通文件内容，也不受 copy 内容字节预算；成功 unlink 以 mutation journal 更新 residual member/hardlink/parent 基线。系统 Trash/上游 atomic 首版 fail closed，Plain permanent delete 不建立上游 Undo且仅在 `deleted` 后 soft-revert working copy。token 防 receipt 伪造、错项和重放但不证明 WebView 点击，确认 UX 由唯一 coordinator、CSP、无 Extension Host 与 Harness 守住，授权边界仍是 Rust capability。
- F170 系统 Trash 是与上一条 permanent delete 正交的平台合同：同样先做 capability snapshot、DOM confirm、mutation gate 与逐项最终重验，但最终调用 macOS Foundation、Windows `IFileOperation` 或 freedesktop.org Trash adapter；绝对路径只存在于 Rust。结果只允许 trashed/retained/outcome-unknown，首个非成功停止余项并 rescan；任何失败都不得改走永久删除。平台 API 只接受 pathname，因此最终重验到 OS 调用间的同 UID namespace race是公开边界；Plain 不把它包装成 capability-relative 原子删除，也不建立自己的 Trash Undo。
- 每窗口 mutation 与 root replace/remove/window close 共享独立 gate，并统一使用 `mutation gate -> workspace state` 锁序；写线程拿到 gate 后重验 lease，保证授权撤销与磁盘副作用具有明确先后关系。只读操作继续锁外执行并丢弃撤销后的迟到结果。
- symlink 可以显示；只有 capability 解析后仍位于同一 root 内的相对链接可跟随。删除链接只删除目录项，递归扫描与删除不得跟随越界链接。
- 非 UTF-8 名称不得通过 lossy conversion 变成后续可操作路径；在无损 opaque handle 落地前返回明确的不支持状态。
- watcher 使用每 root 一个 `notify::RecommendedWatcher`；回调只写入 dirty/rescan 状态和有界唤醒队列。事件只是可能合并、乱序或丢失的提示，队列满、watch error、睡眠恢复和 root rename/delete 都触发 capability-based rescan。
- Rust 暴露不可变、可审计的 workspace 写能力 DTO；前端在 provider 注册前读取，只有 create、exclusive rename、copy/move、delete 和 versioned write 全部安全可用的平台才移除 provider `Readonly`，其余平台保持只读。
- 保存使用 allowlisted、可写 filesystem 上的无状态 `wv1` metadata digest、同一 Rust handle 产生的 `PLR1` read-with-stat receipt、8 MiB `PLW1` raw write frame、同目录高熵 stage 和 handle-relative 原子替换。PLR1在Rust侧始终是Raw response；JS侧严格接受Tauri固定的ArrayBuffer channel结果或macOS/iOS/eval fallback dense number[]并立即复制，两者不能拆成JSON metadata+bytes。只有同时通过保守 uid/gid/mode/parent静态 writer eligibility 的 existing regular file才签 token；普通 tokenless file及 root 内 symlink读取仍可打开，但以 `ETAG_DISABLED + Readonly` fail closed。固定 Workbench patch 只对 `plain-workspace:` 贯穿私有 read/write receipt：首次内容与 token 不再来自并发 IPC，权威 read/write receipt即使 mtime回拨也整份替换 model baseline；preferredContents和MOVE/COPY内存 snapshot则无条件改用 `plain-buffer-no-baseline`，不能与独立 stat token配对。`written` 直接返回本次发布验收的完整 stat，不再 post-write resolve；缺失/force/stale token fail closed。Rust 在 mutation gate 内从 root 重走 parent chain、两次重验 target，并验证 stage content/identity 后才覆盖；发布后再次从当前 root重走 parent再验 target。rename observation、directory sync、target observation 与 outcome unknown 使用带发布证据的严格结构化非成功状态，不能自动重试或回滚；dispatch 后未知 rejection也按 unknown触发 root rescan，save error UI不得提供盲目 Retry/Overwrite。provider 不维护“最近版本”缓存。Linux/macOS 没有 expected-inode conditional replace，最后一次 parent/stage/target验收到 rename 间，以及最终 postcheck到返回之间，任何有 namespace/stage写权限的外部进程仍可竞争；token 是冲突检测而不是跨进程 CAS。首版只支持 APFS 与明确 allowlist 的 Linux 本地文件系统、单链接普通 mode 的 existing regular file写入；Windows、symlink、hardlink 和完整 ACL/xattr/resource-fork另立平台合同。
- Rust provider 实现 Workbench 文件 service 所需的窄接口，不给 WebView 全局 fs scope。

### 搜索

- 搜索完全在 Rust 进程内实现，没有外部 rg/ripgrep 子进程：外部 rg 会自行按路径 ambient 遍历文件系统，无法纳入 capability root handle 权威（原先冻结的 sidecar 路线已废弃，修正见 `docs/research/2026-07-23-search-quickopen.md` 决策 2 的完整排除理由）。文件遍历是手写有界 DFS（复用 directory copy/delete 的 cap_std 帧栈范式与条目数/深度预算惯例），不使用 `ignore::WalkBuilder`（构造即要求 ambient 路径并自做 `std::fs` 遍历，同样违反 capability 纪律）；只局部复用 `ignore::gitignore::GitignoreBuilder` 做纯字符串 `.gitignore` 语义匹配（字节由既有 capability reader 读出后按行喂入，不做 I/O）。
- 文本匹配使用进程内 `grep-searcher`/`grep-regex`（对已授权打开的文件 handle 搜索，显式 `BinaryDetection::quit(0x00)` 对齐 rg 的二进制探测语义）；正则只用线性时间 `regex` crate，不支持 `usePCRE2`/lookaround/backreference，语义比上游窄且如实标注，不伪装支持。文件名 include/exclude glob 用 `globset`。
- Quick Open 文件搜索是单次请求-响应；文本搜索是显式的「wake 信号 + 前端 pull」流式协议（`searchId`/`cursor`/按 id 取消、有界队列背压），复用仓库既有事件流先例。Rust 负责 ignore、上限、取消和批次；前端负责分组、预览和替换确认。
- 文件搜索的每个 entry 与文本搜索的每个 batch 都必须携带产生结果的 `{ rootId, path }`，相对路径本身不是跨 root 身份。前端只接受 `rootId` 属于本次 query roots 的结果，并用它构造 `plain-workspace://<rootId>/<path>`；同一相对路径在多个 root 命中时必须保留为多个资源，Quick Open、Search 跳转和 Replace 均不得回退到 `roots[0]`。
- 批量替换先生成 edit plan，再校验文件版本并执行，失败精确报告到单文件。

### 终端

- `portable-pty` 每会话使用专用阻塞读取线程或 `spawn_blocking`。
- 事件包含 session id、sequence、bytes/exit；前端按序写入 xterm。
- 必须实现 resize、kill、窗口销毁清理、字节分片、背压和 shell exit；不能先 lossy UTF-8 再传输。

### Git

- 系统 Git CLI 是唯一写操作权威，调用使用参数数组和机器格式：porcelain v2/NUL/JSON-safe DTO。
- 每个 Git IPC 调用必须携带当前窗口中一个显式、仍获授权的 opaque root id；Rust 在启动 Git 前重新把该 id 解析为 canonical root。单根兼容入口可以自动选取唯一 root，多根时必须要求用户选择，绝不把 `roots[0]` 当成隐式仓库。
- 前端用一个共享 Source Control root selection 驱动 SCM、Graph、Stash 与 Worktrees；自动选择只允许发生在恰好一个 root 时，进入多根后必须等待用户明确选择。History、blame 与 hunk stage 从活动 `plain-workspace://<rootId>/...` resource 推导所属根，不沿用首根或猜测相对路径。
- `git:`、`plain-git-commit-blob:` 与 `plain-git-commit:` 资源 URI 的 authority 是 root id，cache key 因而至少包含 `(rootId, rev/sha, path)`；content provider/resolver 解码后仍把该 root 原样传给 native bridge，禁止跨仓库复用历史模型。
- WebView 可达的 `terminal_start` 必须携带一个显式、仍获授权的 root id；`cwd:null` 只表示该根本身，非空 cwd canonicalize 后也必须仍落在同一根内，绝不遍历全部 roots 接受另一个根或回退到授权顺序第一项。前端只在单根时自动选择；多根必须先由用户明确选择，且每个 tab/split 在创建时冻结自己的 root，后续 selector 变化只影响未来会话。Rust 内部由已确认 DAP adapter 发起的 `runInTerminal` 不经过此 WebView IPC，继续遵循其独立的 adapter 信任与 cwd 合同。
- Debug 启动同样不得读取 `folders[0]`：单根可以自动选择，多根必须先 Quick Pick 一个明确 root，取消时不得读取配置、确认或启动 adapter。`debug_launch`/`debug_attach` 携带并冻结该 rootId；Rust 在 trust 后重验授权，stdio adapter 的进程 cwd 使用该根的 canonical native path，TCP connect 也必须先通过同一 root 授权。每个 debug session 保存自己的 rootId，运行期 `debug_set_breakpoints` 必须携带并匹配它；前端断点身份是 `(rootId, relativePath, line)`，只把当前 session 所属 root 的集合发给 adapter。adapter 首次确认仍按当前完整 workspace roots identity 与精确 `(command,args,transport)` 记录，不把 rootId 重复加入 confirmation subject；配置选择器属于 F210，本切片仍只取所选 root 的首个 launch configuration。
- Git 报告的 repository top level 必须与所选 canonical root 完全相等。若用户只打开了更大仓库的子目录，仓库级 status/refs/stash/写操作会因可能越过 capability 边界而拒绝；不得以 ambient 父仓库 I/O 或未审计的全仓库 pathspec 回退绕过。
- Rust service 把 status、diff、log、blame、refs 和动作转换为稳定 DTO；前端不解析人类文本。
- 初期不混用 `git2`/`gix`。只有性能数据证明需要时，才用 `gix` 做只读缓存，并以 Git CLI 差分测试约束语义。
- 不提供任意 `git_run` 或任意 config 写入；hooks、credential helper、ssh command 等高风险配置不通过 UI 修改。
- 未信任 workspace 只通过文件系统识别 `.git`，不启动任何 Git、shell 或 helper 进程。信任是按 workspace 保存、可撤销的显式授权，提示中列出仓库 Git 配置可能执行外部程序。
- 信任后的后台 status/log/blame/diff 使用 hardened mode：固定内建子命令和参数、`--no-optional-locks`，禁用 hooks/fsmonitor/external diff/textconv/credential prompt，并设置超时、输出上限和取消。
- 只有用户明确触发的写操作或网络操作才允许系统 Git 使用该动作所需的 hooks、filters、credentials、SSH/GPG；UI 先显示动作/目标，网络和破坏性操作再确认。任何失败都不得降级到宽泛 `git_run`。

### Debug Adapter Protocol

- Rust transport 实现按字节计算的 `Content-Length` framing、request sequence、长度上限、超时、取消、生命周期和事件广播。
- stdio adapter 由 `tokio::process` 管理并持续消费 stderr；TCP adapter 仅连接用户确认的地址。
- launch/attach 的 adapter-specific 配置保持 JSON passthrough；核心 UI 只依赖标准 DAP capabilities。
- workspace 未信任或首次启动 adapter 时必须明确确认可执行文件与参数。

### 主题包

- 导入器接受 `.vsix`、解包目录和本机 VS Code 主题目录。
- 只读取 manifest 中白名单 contribution，并把被引用的 JSONC、plist、字体与图标复制到应用数据目录。
- 解包防 zip-slip、symlink escape、zip bomb；canonical id、目标目录和每个资源路径都要验证。
- SVG 禁止脚本、事件属性和外部 URL；TextMate grammar 是应用内静态资源，不是可执行语言扩展。

### 内置 TextMate grammar

- 内置语言支持只从与 Workbench 同版、经 `resources/grammars/audit-manifest.json` 固定的默认语言包读取 `contributes.languages`、`contributes.grammars`、language configuration 与 grammar 静态文件；依赖包的其他 manifest 字段不会进入 Plain 合成的运行时 manifest。
- Plain 在 `initialize()` 后把审计过的 language id、文件关联和只读 `extension-file:` configuration URI 直接登记到 `ILanguageService`，再只向 TextMate 的 grammar extension point 投递 grammar 描述。这样既满足 grammar 对已知 language id 的校验，也不依赖被刻意置空的 `IExtensionService`。
- 所有 configuration/grammar 字节都由内存只读 provider 提供；不导入默认扩展包的副作用入口，不调用 activation event，不创建 local、worker、WASM、remote 或 sidecar Extension Host。
- 新增或升级内置语言包时，必须同步更新 audit manifest、精确依赖白名单、架构 import 拓扑、第三方声明和代表性真实 editor model 的 scope 验收。

### Remote SSH

- 会话由 `src-tauri/src/remote/` 域唯一持有：纯 Rust `russh`/`russh-sftp`（精确 pin）在 Plain 进程内建立并保持 SSH 连接，不 spawn 系统 `ssh` 二进制；其余模块禁止直接引用 russh 类型或建立出站 TCP，由架构守卫锁定单一 owner。`remote_session_connect/disconnect/state` 等窄 IPC 把会话登记为 `(window, sessionId)`，会话状态经有界事件流下发；系统 Git 既有的 SSH 委托（`git/exec.rs` 网络模式）不受影响，两条路径互不混用（ADR 0006 §1）。
- 认证只走 `SSH_AUTH_SOCK` 的真实 agent 协议；不实现密码认证、不读磁盘私钥、不接触或缓存任何密钥材料，无 agent、无可用身份或被拒各自给出独立错误码并 fail closed（ADR 0006 §2）。
- host-key 由 Plain 自有版本化 known-hosts 存储（app-local-data，沿用 ADR 0005 的原子写纪律）显式确认与 pin：首次连接展示算法与全量指纹，取消即零连接；指纹变化硬失败且 v1 不提供「仍然连接」旁路，删除 pin 是显式确认过的产品命令；用户 `~/.ssh/known_hosts` 只读参考，Plain 从不写入（ADR 0006 §3）。
- 来自远程的一切字节（目录名、文件内容、stat、PTY 输出、Git 输出、DAP 消息）按既有 strict 解码纪律处理：有界、fail-closed、拒绝畸形；路径必须相对且经容器化重验，拒绝符号链接逃逸（ADR 0006 §4）。
- `WorkspaceRoot` 是封闭后端枚举：`Local`（`cap_std::fs::Dir` 语义逐字节不变）与 `RemoteSsh`（持有会话引用 + 远程规范化基路径）；既有 `rootId` + `(rootId, relativePath)` 寻址协议与 `plain-workspace://<rootId>/` provider 原样复用，前端对 root 背后是什么后端完全无感。远程 root identity 是 `(host-key 指纹, canonical 远程路径)`，指纹是 identity 的一部分：主机重装后同名路径视为不同 root，旧 root 的信任与备份不迁移（ADR 0007 §1–2）。
- 远程文件系统经 SFTP 通道：`RemoteSsh` 后端实现既有工作区 DTO 面（stat/read/readdir/write/mkdir/rename/delete），每次路径解析都在 Rust 内完成「拼接 → SFTP `realpath` 重验 → 必须仍在基路径之下」，不存在先检查后使用的 ambient 路径组合；写入沿用现有大小上限与版本化写入合同，远程没有本地 staged rename，改用 SFTP 临时名 + rename 近似原子并如实记录差异。远程分支不提供实时 watcher：v1 语义是无自动文件事件，依赖写入/删除/重命名后的显式失效加用户显式刷新，等价于永久处于 ADR 0004 watcher 队列满时的 rescan-on-demand 降级语义（ADR 0007 §3）。
- 远程终端复用 SSH session channel 的 `pty-req` + `shell`，接入既有终端域 DTO/背压/生命周期合同；v1 收窄为远程默认 shell 在远程 home 目录启动，不透传本地环境、不做 profile 枚举或 shell-integration 注入。
- 远程 Git 经 SSH `exec` 通道以参数数组运行远程 `git`（命令行由专用 shell 转义器编码，往返可逆性经敌意矩阵验证），支持核心读子集（status/diff/log）加 stage/commit；fetch/pull/push 等网络或凭据类操作 v1 明确 fail closed（独立错误码，不复用「域未接入」的通用兜底），不做端口转发或凭据代理；后台读取的 hardened 模式只中和 `core.hooksPath`/`core.fsmonitor`，不做本地分支已有的按仓库 filter 名单逐条中和。
- 远程 DAP 经 `exec` 通道启动远程 adapter，`debug::framing` 的 `Content-Length` framing 直接架在通道读写流上，`russh` 类型不外泄到 `debug::session`；v1 只支持 `stdio` 传输，`tcp`/`tcpSpawn` 对远程 root 显式 fail closed（SSH exec 通道无法承载回环端口语义，也不通过端口转发绕过）。DAP 的 `runInTerminal` 反向请求路由到同一会话的远程终端（`pty-req` + `exec` 变体）；adapter 确认门新增「远程」维度，按 host 指纹去重，与本地及其他远程主机各自独立。
- 生命周期严格 fail closed：连接建立、认证与每个通道打开都有独立超时与协作式取消。会话断开时，所有依赖该会话的 root/终端/调试会话立即标记不可用并停止接受操作，不做静默自动重连；脏编辑器内容留在内存，hot-exit 备份分区键从 canonical path digest 扩展为 identity digest（远程 = 指纹 + 路径）以便跨进程按 identity 恢复。显式重连是一次新的信任决策：必须重新校验 host-key（指纹须与 pin 一致）并重新验证 root 身份后才恢复能力；冷启动恢复远程 workspace 不自动连接，展示「需要重连」状态，由用户显式触发。窗口或应用关闭时会话与全部通道显式 shutdown，远程侧不留守护进程，Plain 不在远程主机安装任何常驻组件（ADR 0006 §5，ADR 0007 §4）。
- Recent 记录远程 root 时只存展示名、opaque id 与重连所需的 `(host, port, user, 远程路径)`，不存指纹之外的任何密钥材料。
- 搜索 v1 不接远程，对选中的远程 root 返回 `ROOT_BACKEND_UNSUPPORTED`；其余各域对远程 root 的支持逐域显式声明与实现，未接入的域统一走同一错误码，不静默降级、不半工作（ADR 0007 §5）。
- 不实现端口转发、X11 转发、agent 转发、SOCKS 代理或反向隧道；不存在远程 extension host、远程 settings 同步或远程插件安装。

## 7. 安全边界

- Tauri capability 按窗口和插件最小化；默认不给前端 shell/fs 全局权限，绝不设置 `$HOME/**` 资源 scope。
- 发布配置必须有明确 CSP；不能使用 `csp: null`。
- 外部进程环境变量经过显式继承策略；日志不得记录凭据、完整环境或终端内容。
- 主题导入、文件预览和 Markdown 禁止任意网络请求与脚本执行。
- 危险 Git/文件操作返回预览并由 UI 二次确认。
- IPC DTO 做长度、数量、路径和枚举校验；错误不泄露敏感主目录内容。
- Remote SSH 不做端口转发、agent 转发、X11 转发、SOCKS 代理或反向隧道，也不在远程主机安装任何常驻组件；不存在远程 extension host、远程 settings 同步或远程插件安装。上游 `monaco-vscode-api` 的 Remote Development 死代码（第 4 节提及的 `remote` 类 bundle 残留）继续保持不可达——Plain 自有的 Rust Remote SSH 实现（`remote/` 域，ADR 0006/0007）与它完全独立，是经过重新审计的窄能力，不是重新激活上游 Remote 栈。

## 8. 旧代码迁移与退役门

迁移不采用一次性大删除。每个垂直切片先建立新组合、新 Rust service 和行为合同，再移除对应旧目录：

1. Tauri window/IPC 壳用选定 service packages 显示最小 Workbench。
2. 文件/编辑/恢复切片通过后，当前 `src/vs` 不再作为运行时代码依赖。
3. 搜索、PTY、Git、主题、DAP 各自通过合同后，移除对应旧实现/扩展和测试替身。
4. AI、账号、同步、通用 Extension Host 和所有禁止功能入口彻底删除。
5. 最后删除 Electron 构建、产品配置、旧 CLI/remote、无用资源，重建 notices/SBOM。

任何 `monaco-vscode-api` 升级都要运行 allowlist、包体和 required E2E，防止新增传递依赖重新带入禁止面。

## 9. 可观测性

- Rust 日志使用结构化事件：domain、operation、duration、result、error code；默认不含文件内容。
- 前端错误面板展示可操作的错误码和恢复动作。
- 性能基线记录启动时间、空闲 RSS、bundle size、打开大文件、全文搜索首结果和 10 万文件树扫描。

## 10. 相关决策

- `docs/decisions/0001-tauri-workbench-port.md`
- `docs/decisions/0002-theme-only-extension-boundary.md`
- `docs/decisions/0003-native-git-and-generic-dap.md`
- `docs/decisions/0004-capability-workspace-roots.md`
- `docs/decisions/0005-rust-owned-local-workflows.md`
- `docs/decisions/0006-ssh-remote-workspace-trust.md`
- `docs/decisions/0007-remote-workspace-capability.md`
