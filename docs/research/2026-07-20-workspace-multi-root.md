# Workbench multi-root 调研与技术方案

日期：2026-07-20

## 问题与当前缺口

Rust workspace service 已经把一个窗口的授权工作区表达为稳定 `workspaceId`、单调 `revision` 和最多 256 个 opaque root；add、replace、remove、watcher 生命周期以及跨 root copy/move 也都以 Rust snapshot 为权威。当前缺口不在原生文件能力，而在 Workbench 投影：

- `workspace-projection.ts` 只投影 `snapshot.roots[0]`，其余已授权 root 不会出现在 Explorer。
- `commands.ts` 固定关闭 multi-root context，并让 `addRootFolder` 安全失败；当前没有 remove-root consumer。
- `main.ts` 只注册真实文件 scheme `plain-workspace:`，没有承载声明式 folder 清单的虚拟 workspace 配置。
- CodinGame 默认 `IWorkspaceEditingService` 仍保留上游 add/remove/update 流程；只把 `enterWorkspace` 设为 unsupported 并不能阻止它先创建或改写 workspace JSON。
- 一旦从单 folder identifier 改为 workspace identifier，上游会暴露打开生成配置、最近工作区等通用 surface；Plain 不能让内部配置 URI 变成用户文件、持久历史或可写入口。

因此本项只补“Rust root snapshot → Workbench folders”的窄适配，不引入普通 `.code-workspace` 权限，也不把 VS Code 的通用 workspace 管理恢复为产品能力。

## GitHub 固定源码调研

### Code OSS 1.128.1

Plain 当前 `monaco-vscode-api@35.0.1` 对应 Code OSS commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`，以下判断均固定在该版本：

- `IAnyWorkspaceIdentifier` 把 multi-root workspace 表达为 `{ id, configPath }`，folder workspace 才是 `{ id, uri }`。来源：[workspace identifiers](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/workspace/common/workspace.ts#L106-L140)。
- 存在 configuration/configPath 时 Workbench state 为 `WORKSPACE`；没有必要打开普通本机 `.code-workspace` 文件。来源：[configuration service state](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/configuration/browser/configurationService.ts#L184-L197)。
- Workspace configuration 通过 `IFileService.readFile(configPath)` 读取；加载阶段不要求写能力。固定实现也会监听 provider file-change，但 Plain 生成配置没有协调器外部的写入源。来源：[workspace configuration loader](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/configuration/browser/configuration.ts#L665-L845)。
- `folders[].uri` 会按完整 URI 解析并保留 `name`，所以每个 root 可以继续用独立 `plain-workspace://<rootId>/` authority，不需要泄露绝对路径。来源：[stored workspace folders](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/workspaces/common/workspaces.ts#L198-L233)。
- 默认 add/remove/update 会调用 `WorkspaceConfiguration.setFolders`，最终由 JSON editing service 写 `configPath`；从空或单 folder 开始时还可能先创建 untitled workspace。来源：[abstract workspace editing service](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workspaces/browser/abstractWorkspaceEditingService.ts#L127-L303)。
- Explorer add/remove 与命令面板并非同一个 command 入口；remove 至少有 `removeRootFolder` 和 `workbench.action.removeRootFolder` 两条路径。来源：[Explorer actions](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts#L615-L633)、[workspace actions](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/browser/actions/workspaceActions.ts#L259-L335)。

### CodinGame 35.0.1

固定 CodinGame commit 为 `d8367168c23c9d0a9ba5bc84b8034e5435e9eb93`：

- `workspaceProvider.workspaceUri` 只产生初始 `{ id, configPath }`；配置内容仍由 file service provider 提供。来源：[workbench setup](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/workbench.ts#L42-L70)。
- `reinitializeWorkspace()` 直接再次调用同一个 `WorkspaceService.initialize()`，没有内部排队、取消或 revision 保护。来源：[configuration override](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/configuration.ts#L193-L196)。
- 官方 demo 已使用“内存 provider 中的 `.code-workspace` + `workspaceProvider.workspaceUri`”。来源：[demo registration](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/demo/src/setup.common.ts#L244-L264)、[demo workspace provider](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/demo/src/setup.common.ts#L347-L363)。
- `reinitializeWorkspace` 来自针对动态 folders 的 [PR #242](https://github.com/CodinGame/monaco-vscode-api/pull/242)；它不负责切换 workspace storage，[PR #252](https://github.com/CodinGame/monaco-vscode-api/pull/252) 另行处理了该问题。因此增删 root 时必须保持 Rust `workspaceId` 稳定；真正切换 workspace id 留给重载或后续持久化切片。
- 固定 configuration override 的 `ConfigurationCache` 只把 `file`、`vscode-userdata`、`tmp` 当作即时 provider scheme。自定义 scheme 会先读 cache，再异步等待 provider；这会让 `reinitializeWorkspace()` 返回时 folders 或每个 root 的 `.vscode` 配置仍未收敛。来源：[CodinGame configuration cache construction](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/configuration.ts#L117-L143)、[Code OSS configuration cache](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/configuration/common/configurationCache.ts#L14-L30)。

结论是复用 configuration service 与 `reinitializeWorkspace`，但必须补严格虚拟 provider、Plain 自有串行协调器和极窄 no-cache patch；重写整套 configuration service 会复制大量不稳定 DI 内部实现，风险更高。

## 冻结方案

### 两个互不混用的 scheme

- 真实文件继续使用 `plain-workspace://<rootId>/...`。它的 authority 只接受 UUID v4 rootId，所有 I/O 继续经 Rust capability bridge。
- 生成配置使用独立只读 scheme：

  ```text
  plain-workspace-config://<workspaceId>/workspace.code-workspace
  ```

  authority 只接受当前 snapshot 的 UUID v4 workspaceId；path 必须精确为 `/workspace.code-workspace`，query 和 fragment 必须为空。

不能把配置塞进 `plain-workspace:`：那会让同一 scheme 的 authority 同时代表 rootId 和 workspaceId，扩大现有 URI codec、provider dispatch 和 Harness 的授权状态空间。也不能使用 `file:` 或本机绝对路径，因为生成配置不是用户文件，不应获得环境 fs 权限。

### 生成配置闭集

对 1..256 个 roots 生成有界 UTF-8 JSON，folder 顺序完全服从 Rust snapshot：

```json
{
	"folders": [
		{
			"uri": "plain-workspace://<rootId>/",
			"name": "<displayName>"
		}
	]
}
```

只允许根级 `folders`，不生成 `transient`、`settings`、`tasks`、`launch`、extensions recommendation 或绝对路径。固定 Code OSS 会让 transient workspace 关闭 hot exit，并把它解释为重载后消失；这不是 Plain 当前 root 生命周期语义。来源：[files configuration service](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/filesConfiguration/common/filesConfigurationService.ts)、[configuration extension point](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/api/common/configurationExtensionPoint.ts)。配置写权限和 recent-history 由服务覆盖与 command guard 保证，不能借 `transient` 代替。

零 root 继续投影为空 workspace `{ id }`。1..256 roots 一律投影为稳定 `{ id, configPath }`，包括单 root；这样单根与多根不在两种 Workbench state 间来回切换，配置 URI 也不会随 revision 改名。provider 内容变化后再显式 reinitialize。

### 只读配置 provider

新增独立 provider 实例，并在 `initialize()` 前按固定顺序注册两个 custom providers。配置 provider 只实现：

- 唯一 URI 的 `stat` 与有界标准 `readFile`；返回精确 size、`File`、`Readonly`。独立配置 scheme 不实现 `plainReadFile`、不返回 `plainVersion`，也不进入真实文件 scheme 的私有 PLR1/PLW1 receipt 路径。
- `watch` 只接受唯一文件或 scheme 根并返回 no-op disposable。生成配置只有协调器一个写入源；install 后不发 `UPDATED`，避免固定实现的 50 ms reload scheduler 逃出 FIFO 并与显式 reinitialize 重复加载。
- mkdir、write、delete、rename、copy 及其他路径全部以稳定去敏错误拒绝。
- 每次安装冻结 workspaceId、revision、roots 和生成 bytes；外部对象、Proxy 或晚到 mutation 不能改变已安装内容。

configuration override patch 必须把 `plain-workspace-config` 和 `plain-workspace` 同时加入 `ConfigurationCache` 的 no-cache scheme 闭集：前者保证 workspace file 立即加载，后者保证每个 folder 的 `.vscode` 静态配置探测不先返回旧 cache。Harness 锁定 patch hunk、scheme 常量、两个 provider 的唯一实例、注册次数与先后顺序。

### 单一拓扑协调器

新增 `WorkspaceTopologyCoordinator`，它是安装配置和调用 `reinitializeWorkspace` 的唯一生产入口：

1. 所有 initial/apply、replace、add、remove 和失败重同步任务进入同一个 FIFO Promise 队列。
2. 每个任务先严格 decode 完整 Rust snapshot；绝不在前端 `push`、`splice` 或猜测 root。
3. workspaceId 必须与当前窗口一致；revision 必须单调。旧 revision 拒绝；同 revision + 同一冻结内容为 no-op；同 revision + 不同内容 fail closed。
4. 在队列内按 root 数量分支：零 root 调用 `reinitializeWorkspace({ id })` 回到 `EMPTY`；1..256 roots 先安装最新虚拟配置 bytes，再调用 `reinitializeWorkspace({ id, configPath })`。调用完成才允许下一个拓扑任务进入。
5. native mutation 成功但 Workbench 投影失败时，不能用反向 add/remove 回滚授权。尤其 remove 后，未经系统 picker 不能重新授予目录。协调器保留最新配置，最多执行一次 `workspaceSnapshot → install → reinitialize` 权威重同步；仍失败则返回稳定 `WORKSPACE_PROJECTION_FAILED`，将页面标记为需要重载并停止新的拓扑 mutation。
6. picker cancelled 或 Rust 在 prepare/activate/revoke 前失败时不安装新 snapshot；Rust 既有事务语义保留旧 root/watcher。

固定 configPath 很重要：Code OSS 的 `FileServiceBasedWorkspaceConfiguration.load` 只在 workspace id 变化时替换内部 identifier；同一个 workspaceId 使用随 revision 变化的 URI 可能继续读取旧 path。固定 URI、更新内容、串行 reinitialize 才是与固定实现一致的更新方式。

### 命令与服务边界

`EnterMultiRootWorkspaceSupportContext` 继续为 `false`。当 Workbench state 为 `WORKSPACE` 时，上游 Explorer 的 Add/Remove Folder UI 仍会显示；Open Workspace、Save Workspace As、Duplicate Workspace 等要求 enter-multi-root 支持的通用入口继续隐藏。

Plain 只接管以下 product commands：

- replace：现有 `workbench.action.files.openFolder`、`workbench.action.files.openFolderViaWorkspace`，以及上游 `setRootFolder`，调用 `workspacePickRoots("replace")`。
- add：`addRootFolder`；`workbench.action.addRootFolder` 在固定上游只转发到该 command，调用 `workspacePickRoots("add")`。
- remove：Explorer 的 `removeRootFolder` 与命令面板的 `workbench.action.removeRootFolder` 都必须覆盖。URI 只接受精确 `plain-workspace://<uuid-v4>/`，再把 rootId 交给 `workspaceRemoveRoot`；命令面板无参数时只可通过上游 folder picker 取得待移除 root，不能从 label 或路径猜测。

所有命令只消费 Rust 返回的完整 snapshot，并交给同一个协调器。removed root 的 Explorer 消失来自 workspace folders 投影变化，watcher 不伪造 root `DELETED`。

同时在配置 service overrides 之后覆盖两个上游服务：

- `PlainWorkspaceEditingService`：所有通用 add/remove/update/create/save/copy/enter/pick API 以稳定去敏错误 fail closed；Plain product commands 不经过该服务。
- `PlainWorkspacesService`：recent add/remove/clear 为 no-op，读取为空；untitled/create/delete/enter/identifier API fail closed，dirty workspaces 为空。F030 如需本地恢复，再以 Rust 本地持久化替换它。

`workbench.action.openWorkspaceConfigFile` 仅凭 `WORKSPACE` state 就会出现，必须在已有 API patch 中增加依赖 `EnterMultiRootWorkspaceSupportContext` 的窄 precondition，使其在 Plain 保持隐藏；不能只让点击后报只读错误。Harness 还要拒绝恢复默认 workspace editing、recent persistence、普通 workspace file dialog 或任意生成配置写路径。

仅覆盖 editing/recent services 仍不足以封住直接走 Host/FileDialog 的命令。以下入口必须逐项隐藏并以 Plain command override 稳定拒绝，且进入排除面与 Harness 闭集：

- `workbench.action.closeFolder`
- `workbench.action.openWorkspaceInNewWindow`
- `vscode.openFolder`
- `_files.pickFolderAndOpen`
- `_files.windowOpen`

这些入口不能接受任意 URI、打开新窗口或取得普通 file/workspace dialog；Plain 的 replace/add 只能走上述系统目录 picker + Rust snapshot product commands。未来若需要“关闭工作区”，应作为 Rust 撤销全部 roots 的独立事务实现，不能调用上游 host navigation 冒充 remove。

固定入口来源：[workspace actions](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/browser/actions/workspaceActions.ts)、[workspace commands](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/browser/actions/workspaceCommands.ts)、[file commands](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileCommands.ts)。

### 信任与产品范围

- `enableWorkspaceTrust: false` 和 `workspaceProvider.trusted: false` 保持不变。目录授权只允许文件 I/O，不授予 Git、PTY 或 DAP 子进程信任。
- Workspace loader 会静态探测 `.vscode/settings.json`、`tasks.json`、`launch.json`、`mcp.json`；Plain 可读取静态设置，但 Task、MCP、Extension Host、语言服务和执行面排除 guard 必须继续不可达。
- 本项不引入 workspace storage 切换、云同步、账号、遥测、普通 VS Code extension host 或任意 workspace 脚本执行。
- displayName 重名只影响辨识度，不影响 authority；本项保留 Rust 名称和顺序，不在前端编造后缀。

## 排除方案

- **继续只显示 `roots[0]`**：授权状态与 UI 不一致，无法验收跨 root 生命周期。
- **生成本机 `.code-workspace` 文件**：泄露路径并扩大 fs/dialog/recent 权限，不符合 opaque root 模型。
- **复用 `plain-workspace:` 承载配置**：混淆 workspaceId/rootId authority，扩大 provider 授权分支。
- **启用默认 `IWorkspaceEditingService`**：它会在失败前写 workspace JSON 或创建 untitled workspace；只读 provider 只能兜底，不能作为唯一产品 guard。
- **把 `EnterMultiRootWorkspaceSupportContext` 设为 true**：同时恢复 Open/Save/Duplicate 等不在范围内的 workspace surface。
- **可写内存 provider**：允许通用 Workbench 绕过 Rust root picker 自行改变 folders，破坏单一权威。
- **生成 `transient: true`**：会额外关闭 hot exit，并不负责阻止 recent 或配置写入；与当前 root 生命周期无关。
- **install 后发送配置 `UPDATED`**：会触发 50 ms 延迟 reload，逃出 topology FIFO 并与显式 reinitialize 形成双重加载。
- **native 成功后反向 mutation 回滚**：remove 的反向 add 会绕过系统 picker 重新授予已撤销目录。
- **为每个 revision 更换 configPath**：固定 WorkspaceConfiguration 可能因 workspaceId 未变而保留旧 identifier。
- **重写 configuration service**：必须复制不稳定的 DI、cache、folder configuration 与事件收敛逻辑，改动面远大于极窄 patch。

## 最小工作项与提交顺序

每项都先更新 `progress.md`，通过直接相关的最小验证、清理临时产物并提交后再进入下一项：

1. **安全投影底座**：只读配置 provider、1..256-root projector/串行 topology coordinator、双 scheme no-cache patch、fail-closed workspace editing/recent services、隐藏内部配置 action、main 注册与 Harness/unit tests；add/remove product commands 暂时继续安全拒绝。
2. **新增/替换 root**：接通 replace、`setRootFolder` 和 add command，严格 bridge snapshot 与取消/失败/并发测试。
3. **移除 root**：接通两个 remove command，严格 root URI 提取、最后一个 root、撤销 watcher 与投影失败测试。
4. **Browser multi-root E2E**：新增第二 root、两个 Explorer 树、各 root watcher、跨 root copy/move、移除一个和最后一个 root；验证内部 config/recent/open/save workspace surface 不可达。
5. **CRUD 失败矩阵**：missing-parent create、move retained/partial、delete retained/partial/unknown 的可见错误、保守 refresh 与零伪成功事件。
6. **真实 Tauri 验收与 F020 闭环**：当前绝对 `.app`、系统 picker、真实 WKWebView/FSEvents、多 root 生命周期、全量回归；最后才写 `features.json` evidence/status。

## 验收矩阵

### 单元与 Harness

- 配置 provider：1/2/256 roots，有界 JSON、无 `transient`、稳定 URI、顺序/名称、唯一 URI、query/fragment/错 authority/path 和所有写操作拒绝；watch no-op 且 install 零 file-change event。
- topology：零 root 精确 `{ id }`、非零 root 精确 `{ id, configPath }`、单调 revision、同 revision 幂等/冲突、旧 revision、FIFO、首次失败、一次权威重同步、二次失败锁死、绝不反向 mutation。
- commands：replace/add selected/cancelled；两个 remove 入口；严格 UUID v4 root URI；并发命令不交错。
- services/surfaces：默认 editing/recent API 全部 fail closed；internal config、workspace save/open/duplicate/close/new-window、`vscode.openFolder`、`_files.*`、untitled 和 file dialog 不可达。
- provider dispatch：两个 roots 间 copy/move 与 partial refresh；移除 root 后旧 watcher wake/in-flight sync 被忽略，其余 root 不受影响。
- Harness hostile mutations：删除/交换 provider 注册，改 scheme，加入 `file:`/绝对路径，移除 no-cache 项，恢复通用 workspace editing/recent 或配置写能力都必须失败。

### Browser 与真实原生

- Browser mock 以两个不同 rootId/内容树驱动真实 Explorer，不能只断言 IPC 调用。
- add 后两个根均可展开和编辑；每个 root 的外部变化独立收敛；跨根 copy/move 结果与 retained/partial UI 一致。
- remove 一个 root 后其 URI 立即 fail closed、旧 wake 不复活；remove 最后一个后回到 empty workspace。
- 真实 Tauri 使用刚构建绝对 `.app` 和系统 folder picker，核对 WKWebView、磁盘、FSEvents 与 root 撤权；Browser 证据不能替代这一项。

## 本方案的退出条件

本调研提交只冻结边界和实施顺序，不把方案文本算作功能完成。只有上述六个工作项分别落地、验证、提交，且 `features.json` 每条 F020 acceptance 都有对应 Browser/原生证据后，才能把 F020 改为 complete。
