# F180 本地 Git 完整工作流

日期：2026-08-03

## 目标与既定边界

`F180` 补齐四组非发布功能：branch/tag/remote/upstream 管理；cherry-pick/revert/merge/rebase/reset/reflog/contributor 工作流；可显式选择 hunk 的 staging；以及 trust、credentials、conflict、cancel、destructive outcome 的真实 Git E2E。它延续 ADR 0003，不改变已经接受的架构：系统 Git CLI 是唯一写权威，每项能力使用固定参数的专用命令，WebView 不获得通用 `git_run`、shell、原生路径或凭据，不引入 `git2`/`gix`，也不引入 GitLens/GitKraken 的 Plus、账号、云、品牌、AI 或 PR provider。

本 feature 只补本地产品工作流。发布签名、公证、DMG、Windows/Linux 打包、应用图标与法务确认仍不在本轮范围内。

## 当前仓库事实

审计基于当前工作树、Git 历史、`features.json`、`progress.md`、ADR 0003、F080/F090 研究文档以及本机 Apple Git 2.50.1；没有把旧对话记忆当作进度事实。

### 已经完整存在

- Rust Git 域只有 `exec.rs` 可以构造 `std::process::Command("git")`，其余模块机械禁止直接 spawn；`BackgroundRead`、`Write`、`Network` 三种硬化模式、trust/root gate、输出/超时上限、网络取消与 literal pathspec 已有真实测试。
- 现有 31 条专用 IPC 覆盖 status/diff/show blob、整文件与 blob stage、unstage、commit/amend、discard、fetch/pull/push/preview/cancel、blame、file/line history、commit detail、graph、refs list、stash list/show/push/apply/pop/drop、worktree list/add/remove。
- Source Control 已有显式多根仓库选择、Working Tree/Staged 资源组、commit、网络预览/确认、force-with-lease、stash/worktree 强确认；Graph 已显示 local branches、remote-tracking branches、tags 与 commit DAG。
- 真实 Git 凭据、HTTPS Keychain、SSH agent、普通 push、过期 lease 拒绝、Fetch 后 force-with-lease、网络取消已由 E2E-008 验证；F150 又证明所有 Git/History/Graph/Stash/Worktree 路由都冻结在显式 root。

### 确认缺失或半接线

- `git_refs_list` 与 Graph refs 区完全只读；没有 create/switch/rename/delete branch，没有 create/delete tag，也没有设置/取消 upstream。
- 网络层只能对当前 branch 已配置的 upstream 执行 fetch/pull/push；没有 remote list/add/rename/remove/set-url，也不能在产品内建立 upstream。
- 没有 merge、rebase、cherry-pick、revert、reset；没有 sequencer state、Continue/Abort、局部 Git 写操作取消或冲突后的显式恢复入口。
- 没有 reflog 和 contributor 数据源/入口。Graph/History 虽可浏览提交，但不能把所选提交送进前述历史操作。
- `plain.scm.stageActiveFileFirstHunk` 的底层 `hash-object` + `update-index` 路径是真实的，但命令固定选择 hunk index 0；没有用户可选择一个或多个 hunk 的 UI。
- 现有 mutation 之后 Source Control 自己 refresh，但 Graph/History/Refs 没有统一的产品级 invalidation；完整工作流需要一次 mutation 后由所有已打开 Git surface 重新读取 Rust/Git 权威状态。

## 本机实测补充

以下均在仓库内一次性真实 Git fixture 中执行，不依赖帮助文本猜测：

- `git branch --no-track -- <name> <sha>`、`git branch -m -- <old> <new>`、`git branch -d -- <name>`、`git switch -- <name>`、`git tag -- <name> <sha>`、`git tag -d -- <name>` 均接受明确的 `--` option terminator。
- annotated tag 可用 `git tag -a --cleanup=verbatim -F - -- <name> <sha>`，message 走 stdin，不进入 argv。
- `git remote add|rename|remove|set-url` 的实测调用均接受 `--` 后的结构化参数。`git config -z --get-regexp '^remote\..*\.(url|pushurl)$'` 每条输出精确为 `key\nvalue\0`，适合有界 parser；URL 进入 UI 前必须去掉 password/userinfo 等秘密，只显示 redacted 版本。
- upstream 的 `git branch --set-upstream-to -- <upstream> <branch>` 会报 `fatal: too many arguments`；正确形状是 `--set-upstream-to=<upstream> <branch>`。因此 upstream 只能来自 `git_refs_list` 返回的 `refs/remotes/` 闭集，并在 Rust 端验证固定前缀后拼成单个 option，不能接受自由文本。
- reflog 的稳定读取形状可用 `git reflog show -z --format=%H%x1f%gD%x1f%ct%x1f%gs --max-count=<N>`；前三个字段固定，`%gs` 必须作为最后一个吸收字段用 `splitn(4)` 解析，避免 reflog message 含 `0x1f` 时错位。
- contributor 可用 `git log --all -z --format=%aN%x00%aE` 得到严格的 `name\0email\0` 对；Rust 聚合计数、排序和截断，前端不解析人类格式的 `shortlog`。

## 冻结架构

### 1. 固定能力与输入合同

- 所有可能被解释为 revision 的历史目标只接受 Rust 严格校验的 lowercase hex40 commit id；branch/tag/remote/upstream 名称使用各自独立 validator，禁止 leading dash、NUL/control、空值、超长值和跨 namespace 伪造。新 ref 额外通过固定 `git check-ref-format` 形状验证。
- remote URL 限 4096 UTF-8 bytes，拒绝 NUL/CR/LF/control。配置读取只返回 remote name、redacted fetch URL、redacted push URL；新 URL 只在用户明确 add/set-url 时作为单次专用请求交给 Rust，不持久化在 WebView。
- 每个 IPC 仍携带显式 `rootId`，通过 `SelectedGitRoot` 与 trust gate；多根不猜首根。任何新命令都走 `run_git`/`run_git_with_stdin`，不新增 program seam 或通用 argv seam。

### 2. branch/tag/remote/upstream

- branch：create at exact commit、switch、rename、safe delete；只有 safe delete 明确返回 unmerged 时，DOM 二次确认后才允许 force delete。禁止删除当前 branch。
- tag：lightweight 或 annotated create；delete 始终预览 tag/target 并确认。
- remote：list、add、rename、set URL、remove。remove 会同时删除 remote-tracking refs，必须强确认；URL 变更显示 redacted old/new 值。
- upstream：只允许 local branch + 当前 refs snapshot 中的 remote-tracking branch，支持 set/unset；设置后现有 fetch/pull/push 继续复用原网络实现。

### 3. 历史操作、冲突与取消

- 新增只读 preview/state：target commit、当前 HEAD、ahead/behind 计数、dirty/staged/conflicted 路径上限、当前 sequencer kind。merge/rebase/cherry-pick/revert/reset 在任何写入前都必须先成功取得 preview；preview 失败绝不 fail open。
- merge 使用 `--no-edit`；cherry-pick/revert 使用 `--no-edit`；rebase 是非交互 rebase；reset 显式区分 soft/mixed/hard。hard reset 的确认文案必须列出会被丢弃的 tracked paths（有界截断）并使用独立危险按钮。
- 历史 mutation 由 root/window 绑定的独立 service 串行化并提供 cancel flag。非零退出后重新读取 Git 权威 status/sequencer marker：若仓库进入 merge/rebase/cherry-pick/revert conflict，就返回结构化 `conflicts` outcome 和路径，而不是把它误报为普通失败。
- 提供 Continue、Abort、Cancel 三个不同动作。Continue/Abort 只接受 Rust 当前检测到的 operation kind，调用者不能伪造另一种 sequencer；Cancel 只终止当前子进程，随后仍重新读取并展示真实 in-progress state，绝不声称已经回滚。

### 4. UI 与统一刷新

- 自建一组 Plain Command Palette 工作流：Manage Branches、Manage Tags、Manage Remotes、Set/Unset Upstream、Merge、Rebase、Cherry-Pick、Revert、Reset、Show Reflog、Show Contributors、Continue/Abort/Cancel Git Operation。
- 所有选择项来自严格 DTO；用户文本只用于新 name/URL/tag message。破坏性动作统一使用 Workbench `IDialogService` DOM 对话框，Cancel 零 IPC 写入。
- 新增一个小型 product-owned Git invalidation event；每次成功、conflict、abort 或 cancelled-after-side-effect 的 mutation 都触发 Source Control/Graph/History/Stash/Worktree 的权威 refresh。它只是“重新读取”的通知，不携带仓库状态或原生路径。

### 5. 显式 hunk staging

- 将活动文件的 index bytes 与一次 workspace read snapshot 交给 Monaco diff；Quick Pick 以有界摘要列出每个 change range，允许显式选择一个或多个 hunk。
- 新 helper 一次性把选择集合应用到 index 版本，生成完整 staged blob；空选择、失效 index、二进制/BOM/非法 UTF-8、超出范围全部零写入。Rust 继续只执行 `hash-object --stdin -w --path` + `update-index`，不解析 patch、不调用 `git add -p`、不启动交互终端。
- mutation 完成后统一 invalidation；SCM 必须从真实 `git_status` 重新读取 staged/working-tree 状态，不能用前端乐观数组猜结果。

## 切片与提交顺序

1. **S1A read model**：remote/reflog/contributor Rust parser、DTO、严格 codec/bridge/mock 与 hostile architecture contracts；不接 UI。
2. **S1B ref/config mutation authority**：branch/tag/remote/upstream 专用 Rust 命令、validator、结构化 outcome 与真实 Git tests；仍不暴露半成品入口。
3. **S2 management UI**：Manage Branches/Tags/Remotes/Upstream、DOM 预览确认、统一 invalidation 与 Browser E2E。
4. **S3 history mutation authority**：preview、sequencer state、merge/rebase/cherry-pick/revert/reset、Continue/Abort/Cancel 与真实 conflict fixtures。
5. **S4 history UI**：历史命令、reflog/contributors、冲突恢复与 Browser E2E。
6. **S5 explicit hunks**：多 hunk helper、Quick Pick、authoritative refresh、单元/Browser/真实 Git 回归。
7. **S6 双层收口**：完整静态/单元/Rust/Browser 门禁，真实 Tauri local repo + bare remote 矩阵；复用 E2E-008 的真实 credential/SSH 证据但重测本 feature 新增的 remote/upstream、conflict、cancel、history rewrite 和 selected hunk。完成后关闭 F180，切到 F190。

WIP 始终为 1；每个切片通过其直接验证后立即提交，不等待最终真实桌面矩阵再合并提交。

## 明确排除

- 任意 Git argv/shell runner、interactive rebase todo editor、bisect/submodule maintenance、PR/issue provider、Git hosting API、GitLens/GitKraken 代码或品牌、AI commit/merge/conflict 功能。
- 裸 `--force` push；现有 push 继续只允许 `--force-with-lease`。
- UI 中展示 remote password/token、原生 repository path 或凭据 helper 输出。
