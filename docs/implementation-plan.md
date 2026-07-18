# Plain 实施计划

状态：执行中
更新时间：2026-07-18

## 执行原则

- WIP 上限为 1，一个切片包含实现、测试、进度更新和提交；切换间允许为 0。
- 每个切片先写可执行合同，再替换旧实现。
- 不以目录删除数量作为进度；以用户可完成的纵向场景作为进度。
- 复杂切片由实现者与独立检查者分离，验收结果写回仓库。

## 阶段 0：调研与 Harness

- [x] 审计当前 Code OSS、AI/账号/同步/扩展边界。
- [x] 调研 SideX、monaco-vscode-api、Terax、Athas、Lapce、Zed、Helix、GitLens 和主题格式。
- [x] 固化产品范围、架构、ADR、功能矩阵和测试策略。
- [ ] 建立可运行的一键初始化与架构检查脚本（随 Tauri 骨架完成）。

退出条件：新会话只阅读仓库文件即可准确继续。

## 阶段 1：Tauri 最小闭环

1. Tauri 2 Rust application、窗口、菜单和 Vite 入口。
2. 以显式 allowlist 组合最小 `monaco-vscode-api` Workbench；加入禁止 service/import 架构检查。
3. 最小 TypeScript Tauri service bridge 与统一错误 DTO。
4. capability/CSP 最小权限、app data 路径和本地 settings。
5. 前端 browser mock bridge、Rust command test harness。

退出条件：`pnpm tauri dev` 显示 Workbench；`pnpm check` 同时覆盖 TS/Rust 和禁止依赖；无 Electron、Extension Host 或 AI/Auth/Sync service 参与。

## 阶段 2：编辑主链

1. workspace scope 与安全路径层。
2. 文件树读取、CRUD、watcher。
3. 编辑器模型、打开/预览/固定、保存、外部冲突和热退出恢复。
4. Quick Open、全文搜索、替换与取消。
5. 内置 grammar 和默认主题。
6. 本地 VSIX/目录颜色主题导入。
7. 文件图标和产品图标主题。

退出条件：从空应用打开 fixture，完成创建、编辑、恢复、搜索替换和主题迁移；浏览器与真实 Tauri 两层通过。

## 阶段 3：终端与 Git

1. Rust PTY 单会话，再扩展多标签/拆分/恢复。
2. Git repo/status/diff/stage/commit/push-pull 基础主链。
3. blame、file/line history、compare、revision navigation。
4. graph/search、branches/tags/remotes/stashes/worktrees。
5. merge/rebase/cherry-pick/revert/reset 的确认与冲突状态。

退出条件：真实终端能运行交互命令；fixture Git 仓库能完成从修改到提交、历史定位和分支/worktree 操作。

## 阶段 4：通用 DAP

1. framing/parser/transport 的纯 Rust 合同测试。
2. adapter process/TCP 生命周期、capabilities 和请求路由。
3. breakpoint、stack、variables、watch、evaluate、控制栏和 debug console。
4. `launch.json`、attach、`runInTerminal` 和未安装 adapter 错误体验。

退出条件：使用仓库内 mock adapter 完成全流程；再用本机已有 adapter 做一次真实断点验收。

## 阶段 5：旧体系退役与发布验收

1. 删除 AI/Chat/Agent/MCP/Copilot 代码、依赖、产品字段和测试。
2. 删除 authentication/accounts/sync/edit sessions。
3. 删除 Extension Host、gallery/management、非主题扩展和相关 API。
4. 删除 Electron main/shared/utility、Node native service 和旧 CLI/remote/tunnel。
5. 删除语言环境、LSP、tasks/testing/notebook/remote 等范围外功能。
6. 重品牌化 bundle id、protocol、data dir、菜单、图标和产品文案。
7. 重新生成 ThirdParty Notices、SBOM 和跨平台打包配置。
8. 完整浏览器 E2E、真实 Tauri 电脑操作、性能与数据防丢验收。

退出条件：仓库不再构建或包含可达的 Electron/AI/账号/同步/通用扩展执行路径；所有 `features.json` 必需项为 complete 且带测试证据。

## 每个工作项模板

1. 在 `features.json` 把一个条目标成 `in_progress`。
2. 在 `progress.md` 写清验收命令和风险。
3. 实现最小纵向闭环。
4. 按 `docs/testing.md` 验证。
5. 清理临时目录、截图、日志和构建产物。
6. 更新状态和已知问题。
7. 创建一个语义化 Git 提交。
