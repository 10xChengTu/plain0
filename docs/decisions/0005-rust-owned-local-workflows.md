# ADR 0005：本地状态、文件打开与系统 Trash 由窄 Rust 服务拥有

- 状态：接受
- 日期：2026-08-02

## 背景

F170 开始前的真实产品状态与“打开文件、最近项目、本地设置、快捷键、自动保存、Untitled、新窗口和系统 Trash”目标之间有完整链路缺口：

- `WorkspaceService` 只在进程内保存每个窗口的 root；冷启动得到空 workspace。
- `PlainWorkspacesService` 的 recent API 固定返回空数组，其写方法是 no-op。
- 通用 Open File、Untitled、Save As、New Window 和 workspace lifecycle command 已按既有安全决策从 vendor patch 移除并由 Plain 稳定拒绝。
- files service override 默认把 `vscode-userdata:` 放在内存 provider 中；设置和快捷键即使能写也不会跨进程保存。
- `files.autoSave` 被固定为默认 `off`，但没有产品自有的持久配置入口。
- ADR 0004 的首版删除合同只实现永久删除，并明确让 `useTrash: true` fail closed；系统 Trash 需要 root 外 OS API，不能伪装成同一个 capability-relative unlink。

重新启用上游 `IFileDialogService`、通用 host/window service 或宽泛 `file:`/Tauri fs scope 会重新暴露绝对路径、任意导航和未经 Rust 授权的文件访问，因此不采用。

## 决策

### 1. Rust 本地状态是唯一持久化权威

- 新增 app-local-data 下的版本化本地状态域；Rust 负责读取、校验、原子替换和损坏隔离，WebView 不接收状态文件的原生路径。
- settings 与 keybindings 只暴露两个精确逻辑资源：`/User/settings.json` 和 `/User/keybindings.json`。前端可继续使用 Workbench 的 `vscode-userdata:` 配置/快捷键读取链，但 provider 的实际读写必须经过窄 IPC；tasks、snippets、profiles、MCP、extensions 等其他 user-data 路径全部返回不支持。
- settings 内容必须是有界 UTF-8 JSONC object，keybindings 必须是有界 UTF-8 JSONC array；Rust 在发布前解析验证。写入使用同目录高熵临时文件、flush 和原子 rename，不接受任意文件名或 native path。
- 多窗口通过 Rust revision/event 收敛同一份全局 user data；迟到 revision 不得覆盖较新的内存内容。

### 2. Open File 不建立第二条宽泛文件系统

- `File: Open File...` 只能调用 Rust 原生文件选择器。首版把每个所选文件的 canonical parent 作为显式 workspace root 授权，再用既有 `plain-workspace://<rootId>/<relativePath>` provider 打开文件；相同 parent 去重，root 总数继续受 256 上限约束。
- 这意味着从当前 workspace 外打开文件会把其父目录显示为一个新 root。这是刻意、可见的能力提升，优于隐藏一个可访问任意文件的第二 provider；不得把绝对文件 URI 直接送入 WebView。
- 选择取消时 topology、recent 和 editor 均不变化。任一 parent 授权失败时整批在 commit 前失败，不留下半授权 root。

### 3. Recent 与上次 workspace 只保存已明确授权过的目录

- Rust 私有历史最多保留 20 个 workspace entries；每项保存有序 canonical roots、无路径的显示标签、最近打开时间与 opaque recent id。IPC 列表只返回 id、label 和 root labels，不返回绝对路径。
- 选择 recent 时 Rust 重新打开所有目录 capability、重验可用性并一次性替换当前窗口 scope；缺失、权限变化或类型变化返回稳定错误，不能部分恢复或回退到剩余目录。
- 正常 root replace/add/remove 成功后才更新 history/last-workspace。冷启动在首个 `workspace_snapshot` 前尝试恢复最后一次完整 root set；失败时保持 empty 并保留可诊断的 path-free 状态，不猜测其他 recent。
- rootId、workspaceId 和 watcher epoch 每个进程/窗口重新生成；持久记录只在 Rust 内映射到新的 opaque ids。

### 4. Untitled 使用 Workbench 模型，但保存与恢复仍由 Plain 拥有

- 新建文本使用 Workbench 的 untitled working-copy/model 语义，不重新实现 Monaco 文本模型。
- Untitled hot-exit 内容进入独立的 app-data scratch 分区，使用 Rust 生成的稳定 scratch id；它不伪造 workspace root，也不进入搜索、Git、PTY 或 DAP。
- Save As 只能调用 Rust save picker。macOS 的 `NSSavePanel` 文件选择只决定文件名与候选位置，不得把所选文件 URL 隐式升级为父目录 capability；文件名确定后必须再由原生目录选择器显式取得父目录授权，第二次选择的目录是最终 parent authority，任一步取消都不得改变 topology 或写入字节。新目标以 capability-relative no-replace create 发布；已存在目标必须先取得当前 version receipt并显示显式覆盖确认，再走正常 versioned-write 合同。取消、拒绝或冲突时原 Untitled 保持 dirty。
- 只有目标字节成功发布并由 provider 接纳后才替换/关闭 Untitled editor；任何失败不得先 discard scratch backup。

### 5. New Window 是固定应用窗口，不是通用 host navigation

- WebView 只能请求“创建一个 Plain 窗口”，不能提交 label、URL、脚本、原生路径或任意窗口配置。Rust 生成唯一 label，固定加载应用入口，并继承生产/E2E 窗口的安全属性。
- Rust 必须从 `app.config().app.windows` 克隆运行时已经合并完成的 `main` `WindowConfig`，只把 label 替换为 `plain-window-<Rust UUID>` 后交给 `WebviewWindowBuilder::from_config`；不得另写一份容易漂移的宽高、URL、incognito 或 WebView 安全配置。Tauri capability 只从精确 `main` 扩到精确前缀 `plain-window-*`，权限仍只有事件 listen/unlisten，不得用全窗口 `*` 或新增通用 core/plugin 权限。
- 动态新窗口的首次 `workspace_snapshot` 固定从 empty scope 启动，不消费全局 last-workspace restore；只有静态 `main` 窗口可在进程冷启动时恢复 last workspace。创建新窗口不迁移、复制或清空当前窗口的 root、editor、dirty working copy、backup、scratch、PTY 或 DAP 状态。
- 每个窗口继续拥有独立 workspace scope、watcher、terminal、debug、delete 和 close lifecycle。
- Close Folder/empty workspace 走独立空请求 IPC、topology coordinator 与原生 mutation gate，一次原子替换为零 roots；已是 empty 时是零 history 写入的幂等 no-op。前端在调用 Rust 前必须复用 F160 hot-exit 的有界稳定快照算法，等待每个 modified working copy 的精确 backup 成功；hot exit 关闭、内容持续变化或任一 backup 失败时拒绝撤销 capability。成功清空后才把 recent 的 last id 置空，已有 history entries 不删除；不得触发窗口 shutdown 事件，也不得复活上游通用 workspace file 或 untitled-workspace API。Untitled scratch 与窗口无 root 的语义独立，Close Folder 后继续留在原窗口；workspace 文件 backup 保留其稳定 root identity，重新授权原 root 后按既有恢复链找回。

### 6. 系统 Trash 是独立平台操作，永不降级为永久删除

- Trash 与永久删除使用不同 command、receipt 和结果类型；`useTrash: true` 只有在当前平台 adapter 可用且 Plain coordinator 已完成 prepare/DOM confirm/begin 后才允许进入 Rust。
- Rust 仍先以 workspace capability 建立 1..64 个无重叠顶层 entry 的有界 identity snapshot，并与 root replace/remove/window close 共用 mutation gate。绝对路径只在 Rust 平台 adapter 内由已授权 root 私有元数据构造，绝不进入 IPC。
- macOS 使用 Foundation `NSFileManager.trashItemAtURL`；Windows 使用 `IFileOperation` + `FOFX_RECYCLEONDELETE`；Linux 遵循 freedesktop.org Trash 1.0（同文件系统优先，跨卷若不能安全完成则明确拒绝）。这些平台 API 都是 pathname API，因此 capability 最终重验与 OS 调用之间的同 UID namespace race 是公开边界；不得宣称与 handle-relative 永久删除同等的跨进程安全性。
- 每项只报告 `trashed`、`entryRetained` 或 `outcomeUnknown`。首个非成功结果立即停止余项并触发相关 root rescan；已经进入系统 Trash 的项不回滚。失败提示必须明确“未移入回收站”，绝不能自动调用永久删除。
- Plain 不实现自己的 Trash restore/Undo；恢复由操作系统 Trash UI 完成。`FileAtomicDelete` 继续不声明。

### 7. Workbench 布局只持久化审计过的窄状态

- `IStorageService` 继续向 Workbench 提供同步读写语义，但 Plain 只把布局尺寸、栏位可见性/位置、active container、pins/placeholders 和固定 view state 的精确 allowlist 交给 Rust；历史、认证、编辑内容、扩展状态及任意未知 key 不得进入本域。
- profile 状态保存到 app-local-data 的单一全局文件；workspace 状态按 Rust `WorkspaceRootsIdentity` 的稳定 root-set digest 分区。digest 和原生路径都不进入 IPC，空 workspace 不接收任何 workspace entry。
- 初始快照必须在 `initialize()` 前完成严格 DTO 解码并同步 seed；root topology 变化只有在 Workbench 已采用并通过 id/configPath/root URI 核对后才切换 layout 分区，失败进入现有永久 reload boundary，不能继续使用旧分区。
- 运行中的 topology adoption 不会重建 Workbench layout/view 实例；分区 seed 后必须把该 workspace 的审计快照投影到既有 part/pane runtime。新空分区固定回到左侧 Explorer、隐藏 panel，既有分区恢复自己的位置、可见性与 active container；profile 尺寸和 pins 仍按合同共享。runtime 投影失败与 storage 分区失败同样进入 reload boundary。
- Primary Side Bar 的左右位置以 workspace storage 为唯一权威；固定 vendor patch 禁止 `workbench.sideBar.location` 这一旧全局 setting 在加载或运行时覆盖该状态，并让既有布局命令直接更新 Workbench runtime state 与 Plain 专用 context key。新 root-set 因而从左侧默认值开始，既有 root-set 只恢复自己的位置。
- 普通变更可有界 debounce，但原生关闭必须先触发 Workbench `onWillSaveState`、再等待 Rust 原子发布，最后才回 lifecycle allow。`window.confirmBeforeClose` 固定为 `never`，避免 WebView 的重复通用确认先于 Plain 原生 veto 拦截关闭；dirty working-copy 等真正数据风险仍由原生生命周期处理。Rust 采用 create-new stage、sync、回读摘要和 rename；损坏文件 quarantine，symlink/超限/未知字段 fail closed。

平台依据：

- Apple App Sandbox 文件访问：<https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox>
- Apple `NSSavePanel`：<https://developer.apple.com/documentation/appkit/nssavepanel>
- Apple Foundation：<https://developer.apple.com/documentation/foundation/filemanager/trashitem%28at%3Aresultingitemurl%3A%29>
- Windows Shell `IFileOperation`：<https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-deleteitems>
- freedesktop.org Trash 1.0：<https://specifications.freedesktop.org/trash/latest/>

## 切片顺序

1. S1：Rust-backed settings/keybindings 两资源 provider，并以真实 Auto Save 写盘闭环验收。
2. S2：Open File、Recent、last-workspace restore 与 Rust 私有历史。
3. S3：Untitled、Save As、scratch hot-exit 和冲突/取消路径。
4. S4：New Window、Close Folder 与窗口隔离/dirty protection。
5. S5：系统 Trash 平台 adapter、独立确认协调器和 permanent-delete 非降级对照。
6. S6：完整 Browser matrix 与真实 Tauri 冷启动、系统选择器、多窗口和 Trash 验收。
7. F250：在既有本地状态边界上补 Workbench layout 的窄 Rust 分区、启动前 hydration、拓扑切换与真实重启验收。

WIP 始终为 1；每个切片通过自身最小验证并提交后才进入下一项。

## 结果与代价

- 用户数据、recent 与系统操作都由 Rust 控制，WebView 不获得 native path 或通用 fs/window 权限。
- Open File 首版会显式加入 parent root，行为比 VS Code 的隐藏 standalone file 更窄，但能力边界可见、可撤销且复用已经验证的 provider。
- 系统 Trash 的安全声明诚实地区分 capability preflight 与平台 pathname API；可恢复删除失败时用户会看到错误，而不是得到意外永久删除。
- 需要新增本地状态 schema、严格 IPC codec、跨窗口 revision、稳定 layout 分区、平台条件编译和真实桌面矩阵；这是补齐产品工作流所需的实际成本，不通过恢复上游宽泛 service 或 WebView storage 来规避。
