# F020 watcher / rescan 方案调研

- 调研日期：2026-07-19
- 目标切片：外部文件系统变化能在 Plain Explorer 中有界、可收敛地刷新
- 固定上游：`monaco-vscode-api@35.0.1` / Code OSS `5264f2156cbcd7aea5fd004d29eaa10209155d66`

## 调研结论

### `notify`

Plain 选择稳定版 [`notify 8.2.0`](https://github.com/notify-rs/notify/tree/notify-8.2.0)，不追随仍处于 RC 的 9.x。`notify` 本体是 CC0-1.0，支持 Linux inotify、macOS FSEvents 和 Windows ReadDirectoryChangesW。它的官方文档明确说明：

- [`Event::need_rescan()`](https://docs.rs/notify/8.2.0/notify/struct.Event.html#method.need_rescan) 表示可能丢失了文件系统事件，内存状态的维护者必须从文件系统重建。
- 网络盘、编辑器的不同保存形态、父目录删除、Linux watch 配额和大型目录都会使精细事件不可靠。
- [`Config::default()`](https://github.com/notify-rs/notify/blob/notify-8.2.0/notify/src/config.rs) 默认 `follow_symlinks: true`。Plain 必须显式使用 `Config::default().with_follow_symlinks(false)`，防止递归 watcher 跟随 root 内链接扩大到授权边界外。
- [`inotify`](https://github.com/notify-rs/notify/blob/notify-8.2.0/notify/src/inotify.rs) 会产生 access/open/close 事件，也会把 queue overflow 转成 rescan flag。Plain 必须忽略全部 `EventKind::Access`，否则 capability scan 自己打开目录可能形成自激循环。

### 不采用的现成封装

- [`notify-debouncer-full 0.7.0`](https://docs.rs/notify-debouncer-full/0.7.0/notify_debouncer_full/) 会维护 rename/file-id cache 和路径队列。它适合精细 rename 动画，但会引入递归 file-id cache、更大路径状态和额外线程；F020 首版不采用。
- [Tauri plugin-fs watcher](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/src/watcher.rs) 直接把含绝对路径的 `notify::Event` 发给 WebView，并丢弃 notify/channel 错误。这与 Plain 的 opaque rootId、错误去敏和可收敛事件流相冲突，只作反例。
- Code OSS 的 [Parcel watcher](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/node/watcher/parcel/parcelWatcher.ts) 提供 75 ms 聚合、有界分批、取消和 root failure 处理的参考，但它依赖 Node/@parcel、绝对 file URI 和大量逐路径事件，不能移植为 Plain 的权限边界。

### Workbench Explorer 的实际刷新语义

固定 Code OSS 基线的 [`ExplorerService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/explorerService.ts) 默认只因可见 `DELETED`、真实 `ADDED`，或 `sortOrder=modified` 时的 `UPDATED` 刷新。单独的 root `UPDATED` 在默认排序下会被忽略。

F020 不伪造 root `DELETED`，因为那会让打开的 model/editor 进入 deleted/orphan 语义。本切片增加一个固定上游窄补丁：只对 `plain-workspace:` 的根级 `UPDATED` 调用既有 `refresh(false)` deep refresh。它不改变其他 scheme、非根事件、排序或文件模型语义。打开文件的精细外部冲突/diff 仍属于 F030，不在 F020 冒充完成。

## 冻结的最小方案

```text
notify callback
  -> 忽略 Access，其他变化置 dirty
  -> need_rescan / error / queue full 置 rescanRequired
  -> try_send 容量 1 的唤醒信号
  -> 单 window worker 固定节流并 drain 所有 dirty roots
  -> 在 mutation gate 内取得并重验 WorkspaceRootLease
  -> 用 cap_std::Dir 做有界 root scan，不使用 notify path
  -> 只保留一个 sticky pending generation
  -> window-targeted wake event 只提醒前端 pull
  -> sync/ack 返回 rootId + generation + rescanRequired
  -> provider 发冻结 root UPDATED
  -> Plain-only Explorer deep refresh
```

### Rust 状态与生命周期

- 每个 `(window, rootId)` 持有一个 `notify::RecommendedWatcher`；每个 window 只有一个 worker 和容量 1 的唤醒队列。
- callback 不保留 event path，不锁 workspace，不做 I/O，不 emit Tauri 事件；它只更新 root 的 dirty/rescan bit 并 `try_send`。
- queue full 不丢状态：dirty/rescan bit 是权威，queue 只是唤醒令牌。扫描期间到达的 bit 保留到下一轮。
- worker 对 root 执行现有有界 `read_directory("")` capability scan。它不维护完整原生文件树；成功与失败都会产生一个保守 root invalidation，失败强制 `rescanRequired=true`。
- root 私有保存 canonical watch path 和授权 identity。canonical path 只供 `RecommendedWatcher::watch` 使用，绝不成为重扫 I/O 输入或 IPC 输出。
- 新 root 使用 `准备 capability -> 创建 inactive watcher -> 提交 scope -> activate + rescan`。watcher 创建失败时 snapshot/revision 必须完全不变。
- replace/remove/close 在 `mutation gate -> workspace state` 内先 detach/cancel；释放锁后再 drop watcher 和停 worker，防止 callback/drop/join 锁反转。旧 registration epoch 的迟到 scan/event 丢弃。
- `RunEvent::Resumed`、显式初始订阅、notify error、`need_rescan()` 和 root rename/delete 都进入同一 `rescanRequired` transition。

### IPC 与前端收敛

- Tauri event 只是 window-targeted wake hint，payload 不含 root path、relative path、notify error 或原始系统错误。
- Rust 对每个 root 最多保留一个未确认 pending generation。新变化在 pending 期间只继续置 dirty，不无界累积。
- 严格 `workspace_watch_sync` request 最多包含 256 个 `{ rootId, acknowledgedGeneration }`；response 只包含 `workspaceId` 和有 pending 的 `{ rootId, generation, rescanRequired }`。generation 是正 `u32` / JavaScript safe integer，不复用 workspace authorization revision。
- native bridge 把 wake/listen/sync/ack/timer 封装在平台适配层；`PlainBridge` 仅暴露高层 `workspaceWatch(rootId, listener)`。事件丢失时，低频有界 sync 仍会 pull 到 sticky pending generation。
- provider `watch()` 按 root ref-count 复用订阅，不经 mutation gate，readonly 与 supported 模式必须完全一致。最后一个 disposable 停止该 root 的前端订阅；pagehide 停止全部 listener/timer。

## Harness 与验收矩阵

Harness 必须锁定：

- `notify = "=8.2.0"`、`with_follow_symlinks(false)`、每 root 一个 `RecommendedWatcher`、唯一容量 1 唤醒队列和单 worker。
- callback 不使用、不序列化、不记录 notify path；全 app 不出现第二 watcher/ambient scan/recursive walker 路径。
- dirty/rescan/pending/ack/generation 状态是闭集，无界 channel、逐事件 Tauri emit、多 pending batch、无 ack 推进均失败。
- root 安装失败原子回滚，replace/remove/close/resume 和旧 epoch 迟到结果有负例。
- IPC DTO 精确 own-data/键闭集/UUID v4/safe integer，不出现 canonical/relative path 字段。
- Explorer 补丁只命中 `plain-workspace:` 根 `UPDATED`，不把它改成 `DELETED`，不影响其他 scheme 或非根事件。

最小验收覆盖：

1. 重复 storm 只占一个 wake，queue full 后多 root 都收敛。
2. notify error、`need_rescan`、scan failure、resume 和显式刷新均发 `rescanRequired`。
3. scan 期间再 dirty 必须在 ack 后产生下一 generation；丢失 wake event 后 timer sync 仍拉到 pending。
4. root replace/remove/window close 后旧 watcher 零事件，多窗口不串流。
5. 外部/dangling/loop symlink 不被 watcher/scan 跟随，恶意绝对 event path 不触碰 root 外 sentinel。
6. Browser E2E 在 supported 和 readonly 两种 capability 下，对已展开树外部新增/删除后都能刷新；readonly 仍是零 native mutation。
7. 真实 macOS Tauri/FSEvents 完成 external create/edit/rename/delete 和窗口关闭验收。
