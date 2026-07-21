# Browser multi-root watcher E2E 调研与技术方案

日期：2026-07-20

## 目标与边界

本项只补 `F020` 的 Browser/Workbench/TypeScript bridge 证据：两个已投影且已展开的 workspace root，分别在有 wake 和丢 wake 两种情况下接收外部新增，最终由真实 Explorer 显示正确文件。

它不修改生产 watcher 协议，不新增测试专用生产 API，也不替代 Rust capability、真实 `notify`/FSEvents、WKWebView 或磁盘验收。主动 create/copy/move 已在上一切片覆盖；本项的所有变化都必须来自 mock native watcher，而不是 FileService mutation event。

## GitHub 与固定源码调研

### Code OSS Explorer

Plain 当前 Workbench 运行时固定到 Code OSS `5264f2156cbcd7aea5fd004d29eaa10209155d66`。该版本的 [`ExplorerService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/explorerService.ts#L35-L112)：

- 以 500 ms scheduler 聚合 `onDidFilesChange`；
- 对 DELETE/UPDATED 遍历全部 Explorer roots，对 ADDED 检查已解析 parent；
- 命中后调用 `refresh(false)`。

固定实现的 [`refresh`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/explorerService.ts#L328-L345) 会忘记每个 root 的 children 并递归刷新整个 view。它还会在窗口重新获得焦点时刷新，以补偿缺失事件。因此本 E2E 必须保持页面焦点稳定、禁止手动 Refresh，并同时检查 native sync/ack；只看到文件出现不足以证明 Plain watcher 链。

固定 [`WorkspaceWatcher`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/workspaceWatcher.ts#L125-L202) 会随 workspace folders 增删分别 watch/unwatch。Plain 不复用它的 file URI/逐路径事件，但 Browser 证据同样必须保持两根同时订阅，并证明一根变化不会推进另一根水位。

### notify 与 Tauri 现成方案

`notify 8.2.0` 官方源码列出的 [known problems](https://github.com/notify-rs/notify/blob/notify-8.2.0/notify/src/lib.rs#L30-L37) 明确指出网络文件系统可能完全不产生事件；[`Watcher::watch`](https://github.com/notify-rs/notify/blob/notify-8.2.0/notify/src/lib.rs#L323-L337) 也说明被监听路径重命名或删除时行为可能出乎预期。事件因此只能是提示，不能是最终状态。

Tauri [`plugin-fs` watcher](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/src/watcher.rs) 直接向 WebView 发送含路径的底层事件，不提供 Plain 所需的 opaque root、sticky generation、exact ack 和丢事件收敛合同，继续只作反例，不能接入产品或测试。

结论：保留 Plain 既有“window-targeted wake 只触发 pull、2 秒 timer 必须独立收敛”的方案，不复制 Code OSS/Node watcher，也不把 raw notify path 带入 Browser fixture。

## 当前实现事实

`app/platform/tauri/workspace-watcher.ts` 已具备所需生产语义：

- 默认 poll interval 为 2,000 ms；wake 调度 0 ms urgent pull，普通循环使用 poll interval。
- 每次 pull 从当前 root map 生成有序 `{ rootId, acknowledgedGeneration }` 列表，只接纳请求集合内的 response roots。
- pending 按 root 分发；只有该 root 的全部 listener 成功后才推进其 ack，随后立即 pull 一次提交 ack。
- transport/listener 失败不推进 ack，低频 timer 继续重试。

现有 multi-root Browser mock 已有每 root 独立 `nextGeneration`、单一 sticky `pending`、有序双 root sync request、response exchange 记录，以及 external-create/emit-wake seam。无需第二套 fixture，但要先补齐与生产 browser mock 一致的 pending-behind-dirty latch：pending 未 ack 时的新变化继续置 dirty，exact ack 清除旧 pending 后立即晋升下一 generation，不能静默丢失。

## 选定场景

新增一个独立测试，不并入 remove-root 或 all-true write 场景：

1. 使用默认 readonly multi-root mock，从 EMPTY 经 Open Folder/Add Folder 进入双根。
2. 展开 primary `plain-workspace` 与 secondary `plain-library`，等待两根 generation 1 都被返回并 exact ack。
3. 每一阶段都等待上一 generation 的 ack 完成后再制造下一变化，避免 sticky pending 合并掩盖 per-root 独立性。
4. 即时阶段把 external-create 挂到下一次已知空 sync 的返回边界：mock 在该 sync 尚处于 in-flight 时原子新增文件并投递 wake。正常 handler 会把下一次 pull 标记为 urgent；若 handler 退化为 no-op，则只能在完整的 2 秒周期后再 pull。fixture 用 WebView 内同一 `performance.now()` 时钟记录注入和 pending exchange，直接拒绝不小于 1.8 秒的时间差，不依赖 Browser → Node 返回延迟。丢 wake 阶段则在上一代 exact ack 后直接新增且不投递事件。
5. 按下表依次新增四个唯一 root-level 文件。

| 阶段 | root      | 文件                  | wake deliveries | response pending       | 最终 request ack 水位   |
| ---- | --------- | --------------------- | --------------: | ---------------------- | ----------------------- |
| 1    | primary   | `primary-wake.txt`    |               1 | primary generation 2   | primary 2 / secondary 1 |
| 2    | primary   | `primary-timer.txt`   |               0 | primary generation 3   | primary 3 / secondary 1 |
| 3    | secondary | `secondary-wake.txt`  |               1 | secondary generation 2 | primary 3 / secondary 2 |
| 4    | secondary | `secondary-timer.txt` |               0 | secondary generation 3 | primary 3 / secondary 3 |

即时阶段的协议 transition timeout 与 WebView 内注入→pending 上限均为 1.8 秒，UI timeout 为 5 秒，覆盖 urgent pull 与 Explorer 500 ms refresh；丢 wake 阶段为 7 秒，覆盖 2 秒 poll、ack pull 与 Explorer refresh。fixture external-create 必须严格接收 `emitWake: boolean` 并返回实际 listener delivery 数；`false` 必须返回 0，文件最终出现才可归因于 timer pull。同步屏障和计时证据只属于测试夹具，不进入产品 API。

## 精确证据

每个阶段在独立 exchange watermark 后验证：

- 按 exchange index 顺序先找到“当前 ack 向量 + 只含目标 root 的新 pending”，再找到“上表最终 ack 向量 + empty result”；下一阶段 watermark 必须从该 ack exchange 之后开始，禁止复用历史 generation。
- 任何 response 都不得把未变化 root 作为 pending 返回；request 始终同时含两个 root，顺序仍为 workspace topology 顺序。
- request、response 和 exchange 继续保持既有 exact own-key、UUID、primitive generation 及无 path/error 泄漏合同。
- 必须按 exchange 的 `callIndex` 回查未归一化的原始 `workspace_watch_sync` invocation，并直接检查 `args/request/root` 的 exact own-key 与无任何 `path` 字段；不能只检查 mock 清洗后的 exchange。
- 四个文件都由真实 Explorer 自动出现；测试期间不执行 Refresh、不切换焦点、不调用主动文件 mutation。
- 即时阶段必须先由下一次空 sync 原子注入并投递 wake，随后 pending/ack exchange 在 1.8 秒内出现，且 WebView 内 `pendingObservedAt - injectedAt < 1,800`；丢 wake 阶段只能在上一阶段 exact ack/empty 后注入，防止上一代 urgent ack pull 顺带收走变化。
- wake listener 数始终为 1；无原生 dialog、pageerror、console error 或 toast。

## 排除项

- root remove/replace 后迟到 wake：已有独立 remove smoke。
- 单 root wake/timer：已有独立 Browser 场景。
- watcher queue storm、饱和 generation、listener failure、撤权竞态：已有 Rust/TypeScript 单元与 Harness 测试。
- pending 后再次 dirty 的产品语义由 `workspace-watcher-browser-mock.test.ts` 和 Rust watcher 单元测试直接覆盖；本 Browser 场景只使用与 browser mock 一致的 deterministic latch，不把 Rust worker 的异步扫描时序伪装成 WebView 证据。
- DnD、missing-parent、move/delete partial UI、真实 multi-root Tauri：后续独立工作项。

## 验收

```bash
pnpm check
pnpm exec playwright test tests/browser/workspace.spec.ts -g "converges both workspace roots after watcher wakes and lost-wake timer pulls" --repeat-each=5 --retries=0
pnpm exec playwright test --retries=0
```
