# 端到端桌面验收交接清单（Codex 执行）

更新时间：2026-07-24

## 分工模式

自 2026-07-22 起（用户指示）：Claude 负责实现与所有可自动化的本机测试——单元测试、Rust 测试、确定性 Tauri IPC mock 的 Browser E2E（Playwright）、架构/bundle guard；**真实 Tauri 桌面（Computer Use / 人工驱动）验收不再由 Claude 执行**，全部登记在本清单，最终由用户交接给 Codex 统一执行。

- Claude 每完成一个涉及桌面验收面的垂直切片，必须向本清单追加对应条目（含前置、fixture、步骤、断言、清理），并在 `features.json` 对应 feature 的 `platformGaps` 中引用本清单。
- Codex 执行完成后，应把结果回写到对应 feature 的 evidence，并在本清单勾选。

## 执行环境纪律（适用于全部条目）

1. 构建与绑定：统一 `pnpm tauri:build:e2e`，把 `src-tauri/target/debug/bundle/macos/Plain.app` 解析为**当前仓库绝对路径**后再启动；不得按 `com.plain.editor` bundle id 绑定（旧 `.app` 会造成假阳性/假阴性）。`pnpm tauri:dev:e2e` 的裸二进制无 `CFBundleIdentifier`、不经 LaunchServices，桌面自动化授权层结构性不可见，**不能**用于取样（详见 docs/testing.md）。
2. 首个取样必须轮询至 Activity Bar 出现 Explorer 或 `#plain-bootstrap-status` 明确报错；瞬时空白不是结果。
3. macOS 目录选择器内部列表由系统 XPC 服务（openAndSavePanelService）渲染，自动化点击不可达；导航一律用 `Cmd+Shift+G` 键入绝对路径。
4. 合成键盘在真人键鼠活动时会被让位中止（"user interrupt"）；执行前需确保真实空闲窗口，且注意自动化 wait 原语同样会被该信号打断，墙钟等待应在 shell 层完成。
5. 不可逆确认按钮（如永久删除）点击前必须取得用户即时确认。
6. fixture 放在仓库外临时目录；结束后删除 fixture、截图，并删除 `src-tauri/target` 等大体积构建产物（验收失败时保留以便复跑）。
7. 每步 UI 操作后用 shell 在磁盘核对（字节数、SHA-256）；UI 观察与磁盘核对都要记录。

## 待执行条目

### E2E-001 · F020 真实 multi-root 桌面矩阵（阻塞 F020 的最终原生证据）

状态：待执行。Browser mock 层证据已全部闭合（多根投影/写链/watcher/失败矩阵，见 progress.md 与 `tests/browser/workspace.spec.ts`）；单根真实桌面验收（目录选择器、CRUD、保存、FSEvents 收敛、确认永久删除的取消与执行）已在此前会话通过。本条目补 multi-root 的原生层。

fixture（临时目录中创建）：

- `plain-mr-primary/`：`README.md`（任意短内容）+ 空目录 `src/`
- `plain-mr-secondary/`：`notes.txt`、`move-source.txt`

步骤与断言：

1. 双根投影：Open Folder（`Cmd+Shift+G`）打开 primary → 命令面板 `Add Folder to Workspace` 加入 secondary → Explorer 双根与各自文件正确。
2. 跨根磁盘写链（每步磁盘核对）：primary 新建 `real-note.txt` 输入精确内容保存；secondary `notes.txt` 改写保存；`README.md` 跨根 Copy/Paste（源保留、目标一致）；`move-source.txt` 跨根 Cut/Paste 到 primary `src/`（源消失、内容不变）。
3. 每根独立 FSEvents（全程不点 Refresh）：shell 分别在两根外部创建文件 → Explorer 自动出现；shell 删除其一 → 自动消失；记录收敛时长。
4. root 生命周期：Explorer 右键移除 secondary → 仅剩 primary；命令面板移除 primary → EMPTY（Open Folder 可见）→ 重新打开 primary 成功。
5. 收尾：Cmd+Q；清理 fixture/截图/`src-tauri/target`；`git status --short` 干净。

完成后：将结果写入 `features.json` F020 evidence（nativeScenarios 追加、platformGaps 移除对应缺口）。

### E2E-002 · F020 multi-root 永久删除桌面正向路径（可选补强）

状态：待执行（低优先级）。单根真实永久删除（含取消路径与用户确认后的执行路径）已通过；本条目在双根 workspace 中重复一次「右键/⌘Backspace → DOM 确认 → 永久删除 → Explorer 与磁盘同步消失」。不可逆点击前必须取得用户即时确认。

### E2E-003 · F030 热退出恢复的真实桌面矩阵

状态：待执行。Browser mock 层已闭合（编辑不保存 → reload → 自动恢复 dirty → 保存 discard → 不再复活，22/22 E2E 含此链）；本条目补真实 WKWebView/磁盘/进程层。

fixture：临时 workspace（含一个文本文件）。

步骤与断言：

1. 打开 workspace → 编辑文件不保存（tab 脏点 + Activity Bar 脏计数徽章可见）→ 等待 backup 落盘（`~/Library/Application Support/<app>/backups/<64位十六进制身份>/` 下出现条目文件；身份由 canonical roots 哈希派生，同 workspace 重开应相同）。
2. **强杀进程**（`kill -9`，模拟崩溃）→ 重启应用 → 重开同一 workspace → 断言编辑器自动恢复为 dirty、内容含未保存编辑。
3. 保存 → 磁盘内容正确、backup 目录条目消失；再次重启重开 → 无恢复 tab。
4. 外部删除已打开文件（真实 FSEvents）→ tab 出现删除线装饰（`.monaco-icon-label.strikethrough`）；外部恢复 → 装饰消失。
5. 保存冲突真实路径：外部改写文件后在 app 内 `Cmd+S` → 冲突通知（动作恰为 Reload/Save As.../Details，无 Retry/Overwrite）→ Reload 后内容为外部版本。
6. 清理：退出、删除 fixture 与 backup 目录、删除 `src-tauri/target`。

已知边界（执行方须知）：真实 `WindowEvent::CloseRequested` 关窗握手（关窗前保证 backup 落盘的 veto/等待协议）**尚未实现**——Plain tracker 的 `onFinalBeforeShutdown` 恒不 veto，正常关窗时最后一次节流备份可能未落盘；崩溃路径（kill -9）依赖此前已完成的节流备份。该协议属后续工作项，本条目按现状验收即可，发现关窗竞态属预期，不算回归。

### E2E-004 · F040 Quick Open、搜索与替换的真实桌面矩阵

状态：待执行。Browser mock 层已闭合（S1-S4 全部场景：文件/文本搜索、ignore/exclude 矩阵、流式取消、替换与版本冲突交互，见 progress.md 与 `tests/browser/workspace.spec.ts`）；本条目补真实磁盘、真实大目录规模和 WKWebView 层，这些是 mock 无法替代的维度。

fixture（临时目录中创建）：

- 一个真实规模较大的目录树（至少数千个文件），根目录一个 `.gitignore` 忽略其中一个子目录；该子目录之外的另一个子目录自带独立的 `.gitignore`，再忽略其内部一个文件——用于验证多层 `.gitignore` 按目录分层精确生效，而不是只认根 `.gitignore` 或被上层短路。
- 该目录树内包含至少一个 `node_modules/` 目录（内含若干文件）——用于验证 F040 S5 新注册的 `search.exclude` 默认（`**/node_modules` 等）在真实磁盘规模下确实生效。
- 一个独立的小文本文件，专用于替换版本冲突步骤。

步骤与断言：

1. 大目录真实文本搜索性能与取消：`Cmd+Shift+F` 打开 Search 视图，搜索一个在树中出现次数较多的词，观察流式结果开始渲染的真实时延；在结果尚未完成前清空并输入另一个查询词，断言旧搜索被真实取消（旧查询不再产生新的可见批次，UI 无残留旧结果、无报错）。
2. 真实 `.gitignore`/多层 ignore：确认根 `.gitignore` 忽略的子目录内容完全不出现在 Quick Open 与 Search 结果中；另一个子目录自带 `.gitignore` 忽略的单个文件同样不出现，但同目录下未被忽略的兄弟文件正常出现。
3. `search.exclude` 默认：`node_modules/` 目录下的文件不出现在默认 Quick Open 或 Search 结果中，即使其内容或文件名与查询匹配。
4. Cmd+P 打开文件：在真实大目录树中用 Cmd+P 搜索一个文件名片段，Enter 打开，确认编辑器内容与磁盘该文件内容一致。
5. 替换含版本冲突路径：对专用小文件的一个匹配点击 Replace；若能可靠复现真实竞态窗口，则在点击到保存完成之间用 shell 改写同一文件模拟外部竞争；若时机不可靠复现，退化为——先完成一次正常替换并核对磁盘，再对同一文件手工制造一次「UI 未刷新旧版本上的替换」（例如 shell 改写后立即在 UI 侧对仍显示旧内容的匹配点击 Replace）——断言该次替换走 `FILE_MODIFIED_SINCE` 冲突链，通知动作只有 Reload/Save As/Details（无 Retry/Overwrite），磁盘内容与 UI 呈现的冲突状态一致。
6. 每步 UI 断言后用 shell 在磁盘核对实际内容/SHA-256（尤其是替换前后的文件）。
7. 清理：退出应用；删除大目录 fixture、截图与 `src-tauri/target`。

已知边界（执行方须知）：

- Browser mock 的 gitignore/exclude glob 匹配是刻意简化的子集（精确名、单段名、`*.ext` 后缀、`!` 否定、`**/name`、`**/name/**`，见 `app/platform/tauri/browser-mock.ts` 的 `compileMockExcludeGlob`）；真实 Rust 侧用 `globset` 与 `ignore::gitignore::GitignoreBuilder`，语义更完整。本条目步骤 2/3 是这一更完整语义在真实文件系统、真实规模下的唯一验证点，Browser mock 层不能替代。
- 正则不支持 `usePCRE2`/lookaround/backreference，替换不支持捕获组反向引用（`$1` 风格）——这两点如果在本条目执行中意外被观察到，应按既有已知限制记录，不算新发现的缺陷。
- 每窗口活跃搜索的取消是 best-effort（新查询会立即在前端丢弃旧结果并让 Rust 释放对应队列），不提供跨进程强一致的"已完全停止"信号；步骤 1 断言的是可观察的 UI/结果层面停止，不是 Rust 内部线程退出的证明。

完成后：将结果写入 `features.json` F040 evidence（`nativeScenarios` 追加、`platformGaps` 移除对应缺口）。

### E2E-005 · F050 VS Code 主题兼容的真实桌面矩阵

状态：待执行。Browser mock 层已全部闭合（S0-S4：内置主题激活与选择器、Rust VSIX/目录安全解包、manifest/主题校验与恶意 fixture 矩阵、导入 UX 与注册消费、selection 跨会话持久化与失效 id 回退，见 progress.md 与 `tests/browser/workspace.spec.ts`）；本条目补真实系统文件选择器、真实 `<app_local_data_dir>` 磁盘持久化路径和真实进程重启这几个 mock 无法替代的维度。

fixture（临时目录中构造，不提交仓库）：

- 一个真实、最小的合法主题包 VSIX：
  1. 建目录 `demo-theme/extension/`，写入 `package.json`：
     ```json
     {
     	"name": "demo-theme",
     	"publisher": "plain-e2e",
     	"version": "1.0.0",
     	"engines": { "vscode": "*" },
     	"contributes": {
     		"themes": [
     			{
     				"label": "E2E Demo Dark",
     				"uiTheme": "vs-dark",
     				"path": "./themes/demo-dark.json"
     			}
     		]
     	}
     }
     ```
  2. 写入 `demo-theme/extension/themes/demo-dark.json`：`{"colors": {"editor.background": "#0a0a0a"}, "tokenColors": []}`（一个有辨识度、不与任何内置主题冲突的背景色，用于后续步骤的即时肉眼/CSS 变量核对）。
  3. 在 `demo-theme/` 目录内执行 `zip -r ../demo-theme.vsix extension`（`extension/` 是包内容的固定顶层前缀），产出标准 zip 容器的 `demo-theme.vsix`。
- 一个 zip-slip 恶意 VSIX：复用上面的合法内容，额外加入或替换一个条目名形如 `extension/../../evil.json`（或依本地 `zip`/`python zipfile` 实际行为改用等价的越界写入路径）的畸形归档条目。
- 一个「无主题包」VSIX：合法 zip、合法 `extension/package.json`，但 `contributes` 不含 `themes` 字段（例如一个不声明任何主题贡献的普通扩展 manifest）。

步骤与断言：

1. 真实系统文件选择器导入：命令面板执行 `Plain: Import Color Theme (VSIX)...`，确认弹出的是系统原生文件选择器（非任何模拟/mock 面板）；导航到合法 `demo-theme.vsix` 并选择；断言导入成功 toast 含 `plain-e2e.demo-theme@1.0.0`，Color Theme Quick Pick 中出现 "E2E Demo Dark"。
2. 应用并重启保持：选择该主题，确认 `--vscode-editor-background` 变为 `#0a0a0a`；**完全退出应用（Cmd+Q）并重新启动**（不是页面 reload，是真实进程重启）；重开同一份用户数据目录后应用应在启动完成时即已是该主题，不需要用户重新选择——这是 `theme_get_selection`/`theme_set_selection` 与主题库导入记录二者在真实磁盘上协同持久化的核心证据。
3. 恶意 VSIX 拒绝且去敏：分别对 zip-slip VSIX 与无主题包 VSIX 执行导入命令；断言两者都被拒绝并出现错误 toast，且 toast 文案不包含内部错误码原文（`THEME_PACKAGE_UNSAFE_PATH`/`THEME_PACKAGE_NO_THEMES`）或任何文件系统路径；用 shell 核对 `<app_local_data_dir>/themes/` 下没有为这两次失败导入留下任何半成品（不存在 `.plain-theme-*.tmp` 残留目录，也不存在以这两个失败包命名的已发布目录）。
4. 删除导入主题回退：确认当前主题为已导入的 "E2E Demo Dark"；命令面板 `Plain: Remove Imported Color Theme...` 移除 `plain-e2e.demo-theme@1.0.0`；断言主题立即回退为 Dark Modern（`#1f1f1f`）、Quick Pick 中不再列出 "E2E Demo Dark"；**再次完全退出并重启应用**，断言依旧是 Dark Modern（证明 selection 的清除同样落盘持久化，不只是内存态）；用 shell 核对 `<app_local_data_dir>/themes/` 下该包目录已不存在，且 `selection.plain.json` 或缺失、或其中不含该包对应的主题 id。
5. 每步 UI 断言后用 shell 在磁盘核对 `<app_local_data_dir>/themes/` 的实际内容（目录清单、`selection.plain.json` 是否存在及其内容、确认无残留 staging 目录）。
6. 清理：退出应用；删除 fixture VSIX、本次测试新建的主题库内容、截图与 `src-tauri/target`；如与既有隔离 WebView profile/临时用户数据目录惯例冲突，按既有隔离约定操作，不得污染真实用户数据。

已知边界（执行方须知）：

- 恶意 fixture 的完整闭集（zip bomb、条目数超限、include 环/深度超限、越界路径等 23 个错误码的全部场景）已在 Rust 单元测试层逐项覆盖（`src-tauri/src/theme/unpack/tests.rs`、`theme_json/tests.rs` 等，见 progress.md S1/S2 条目）；本条目只挑 zip-slip 与无主题包两个最具代表性、最依赖真实系统文件选择器路径的场景做桌面级复核，不重复整张矩阵。
- 目录导入（`Plain: Import Color Theme (Folder)...`）与 VSIX 导入共用同一校验管线（见 docs/research/2026-07-24-theme-compatibility.md「决策 2」），本条目只验收 VSIX 路径；目录导入的等价复核不是阻塞项。
- 图标主题（`iconThemes`/`productIconThemes`）留给 F060：本条目 fixture 不声明这两个字段；即便声明，Plain 当前只原样保留而不消费，观察到这一点属预期，不算缺陷。
- 不跟随系统亮暗、无 Settings UI、导入主题不携带 `contributes.themes[].id`（用解析出的 label 或路径 basename 兜底）均为既定收窄，出现属预期。

完成后：将结果写入 `features.json` F050 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口）。

## 后续条目（随切片追加）

- F030 遗留：真实 `CloseRequested` 关窗握手协议实现后，补「正常关窗 → 重开恢复」的桌面验收变体。
- F060 图标主题、F070 PTY、F080-F090 Git、F100 DAP 的真实桌面矩阵按 docs/testing.md「真实 Tauri E2E」清单逐项登记。
- F120/F130 发布与全量原生回归。
