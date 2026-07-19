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
│ ├─ search workers / ripgrep sidecar                         │
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

External local processes: system git, user-configured DAP adapter,
shells, and a fixed-version ripgrep sidecar.
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
- 每个 root 在 Rust 中持有已打开的 `cap_std::fs::Dir` capability；canonical path 是仅供显示、文件身份去重和 watcher 使用的私有元数据，不是 I/O 授权依据。
- 所有路径请求采用 `(rootId, relativePath)` 或经过授权的 opaque handle。wire path 固定使用 `/`，拒绝 absolute、prefix、`.`、`..`、NUL、空组件和平台歧义；WebView 不接收或提交原生绝对路径。
- 读取与 CRUD 必须相对 root capability 执行，禁止先 `canonicalize`/`starts_with` 再用 ambient `std::fs`。跨 root 操作必须显式携带两个已授权 root；普通 rename 默认不覆盖。
- 目录 copy 在任何目标副作用前建立并重验 capability-relative manifest；固定条目、名称、深度、symlink 与逻辑文件字节预算，逐层 `open_dir_nofollow`，特殊文件拒绝。目标父目录不得落入 source directory identity 集合；完整 staged tree 经 receipt 重验后只用原子 no-replace 发布，失败清理不得使用无界递归 helper。
- 跨 root move 在同一次双 root mutation gate 内消费 Rust-only `PublishedCopyReceipt`：普通文件由 publication 前稳定 source/staged target 双侧确认的 SHA-256 digest 绑定，symlink 保存完整 raw payload；正式 target 发布后先分别重验当前 source 与 published target，再以 manifest 驱动的有界逆序 `remove_file/remove_dir` 删除 source。发布后禁止回滚 target；source 零删除或部分删除必须返回结构化非原子状态。没有 expected-inode conditional unlink 或跨文件系统事务，因此 source 最后 identity 检查与删除之间、target 最后验收与 source 删除之间的同 UID 竞态都是公开边界，不能宣称跨进程原子。
- 永久删除由 Plain 批量 coordinator 统一执行 prepare → Workbench 一次确认 → begin 整批预检 → provider 逐项 commit：Rust-only `DeleteBatchReceipt` 绑定 1..64 个非重叠顶层 namespace entry、一次性 token/entryId、窗口/root/path/options 和有界 manifest。固定 Workbench patch 把调用级 authorization 从 `ResourceFileEdit` 透传到同一 Plain provider；缺少授权的 FileService delete fail closed。所有 batch 操作使用 `mutation gate → state`、严格顺序和单 in-flight，每项删除前再次重验；只按固定计划用 parent capability + basename 逆序 `remove_file/remove_dir`，retained/partial 必须结构化报告并停止余项。删除 receipt 不读取普通文件内容，也不受 copy 内容字节预算；成功 unlink 以 mutation journal 更新 residual member/hardlink/parent 基线。系统 Trash/上游 atomic 首版 fail closed，Plain permanent delete 不建立上游 Undo且仅在 `deleted` 后 soft-revert working copy。token 防 receipt 伪造、错项和重放但不证明 WebView 点击，确认 UX 由唯一 coordinator、CSP、无 Extension Host 与 Harness 守住，授权边界仍是 Rust capability。
- 每窗口 mutation 与 root replace/remove/window close 共享独立 gate，并统一使用 `mutation gate -> workspace state` 锁序；写线程拿到 gate 后重验 lease，保证授权撤销与磁盘副作用具有明确先后关系。只读操作继续锁外执行并丢弃撤销后的迟到结果。
- symlink 可以显示；只有 capability 解析后仍位于同一 root 内的相对链接可跟随。删除链接只删除目录项，递归扫描与删除不得跟随越界链接。
- 非 UTF-8 名称不得通过 lossy conversion 变成后续可操作路径；在无损 opaque handle 落地前返回明确的不支持状态。
- watcher 使用每 root 一个 `notify::RecommendedWatcher`；回调只写入 dirty/rescan 状态和有界唤醒队列。事件只是可能合并、乱序或丢失的提示，队列满、watch error、睡眠恢复和 root rename/delete 都触发 capability-based rescan。
- Rust 暴露不可变、可审计的 workspace 写能力 DTO；前端在 provider 注册前读取，只有 create、exclusive rename、copy/move、delete 和 versioned write 全部安全可用的平台才移除 provider `Readonly`，其余平台保持只读。
- 保存使用 allowlisted、可写 filesystem 上的无状态 `wv1` metadata digest、同一 Rust handle 产生的 `PLR1` read-with-stat receipt、8 MiB `PLW1` raw write frame、同目录高熵 stage 和 handle-relative 原子替换。PLR1在Rust侧始终是Raw response；JS侧严格接受Tauri固定的ArrayBuffer channel结果或macOS/iOS/eval fallback dense number[]并立即复制，两者不能拆成JSON metadata+bytes。只有同时通过保守 uid/gid/mode/parent静态 writer eligibility 的 existing regular file才签 token；普通 tokenless file及 root 内 symlink读取仍可打开，但以 `ETAG_DISABLED + Readonly` fail closed。固定 Workbench patch 只对 `plain-workspace:` 贯穿私有 read/write receipt：首次内容与 token 不再来自并发 IPC，权威 read/write receipt即使 mtime回拨也整份替换 model baseline；preferredContents和MOVE/COPY内存 snapshot则无条件改用 `plain-buffer-no-baseline`，不能与独立 stat token配对。`written` 直接返回本次发布验收的完整 stat，不再 post-write resolve；缺失/force/stale token fail closed。Rust 在 mutation gate 内从 root 重走 parent chain、两次重验 target，并验证 stage content/identity 后才覆盖；发布后再次从当前 root重走 parent再验 target。rename observation、directory sync、target observation 与 outcome unknown 使用带发布证据的严格结构化非成功状态，不能自动重试或回滚；dispatch 后未知 rejection也按 unknown触发 root rescan，save error UI不得提供盲目 Retry/Overwrite。provider 不维护“最近版本”缓存。Linux/macOS 没有 expected-inode conditional replace，最后一次 parent/stage/target验收到 rename 间，以及最终 postcheck到返回之间，任何有 namespace/stage写权限的外部进程仍可竞争；token 是冲突检测而不是跨进程 CAS。首版只支持 APFS 与明确 allowlist 的 Linux 本地文件系统、单链接普通 mode 的 existing regular file写入；Windows、symlink、hardlink 和完整 ACL/xattr/resource-fork另立平台合同。
- Rust provider 实现 Workbench 文件 service 所需的窄接口，不给 WebView 全局 fs scope。

### 搜索

- 第一阶段使用固定版本 ripgrep sidecar 并解析 `rg --json`；Quick Open 使用 `ignore` 遍历。
- Rust 负责 ignore、上限、取消和批次；前端负责分组、预览和替换确认。
- 批量替换先生成 edit plan，再校验文件版本并执行，失败精确报告到单文件。

### 终端

- `portable-pty` 每会话使用专用阻塞读取线程或 `spawn_blocking`。
- 事件包含 session id、sequence、bytes/exit；前端按序写入 xterm。
- 必须实现 resize、kill、窗口销毁清理、字节分片、背压和 shell exit；不能先 lossy UTF-8 再传输。

### Git

- 系统 Git CLI 是唯一写操作权威，调用使用参数数组和机器格式：porcelain v2/NUL/JSON-safe DTO。
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

## 7. 安全边界

- Tauri capability 按窗口和插件最小化；默认不给前端 shell/fs 全局权限，绝不设置 `$HOME/**` 资源 scope。
- 发布配置必须有明确 CSP；不能使用 `csp: null`。
- 外部进程环境变量经过显式继承策略；日志不得记录凭据、完整环境或终端内容。
- 主题导入、文件预览和 Markdown 禁止任意网络请求与脚本执行。
- 危险 Git/文件操作返回预览并由 UI 二次确认。
- IPC DTO 做长度、数量、路径和枚举校验；错误不泄露敏感主目录内容。

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
