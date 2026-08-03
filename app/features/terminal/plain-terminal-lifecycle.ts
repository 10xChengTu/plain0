/**
 * Pure, DOM/IPC-free text formatting for `F190` S6 "explicit non-restorable
 * lifecycle" — the real exit-banner message a pane shows once its shell
 * process has actually exited (`plain-terminal-pane.ts`'s `#handleExit`),
 * and the one-time "last run's terminals could not be restored" notice a
 * freshly mounted view shows (`plain-terminal-view.ts`'s
 * `#applyLifecycleMarkerNotice`). Kept separate from those two classes' own
 * DOM wiring, mirroring this domain's existing "pure decision module,
 * DOM-free, independently unit-tested" precedent (`plain-terminal-find.ts`,
 * `plain-terminal-live-refresh.ts`, `plain-terminal-defaults.ts`). Neither
 * function ever interpolates a filesystem path — both are worded from
 * nothing but a plain count/exit code/signal name.
 *
 * # Marker bookkeeping itself is Rust-authoritative, not a frontend state
 * machine
 *
 * Unlike this domain's other pure modules, this one does *not* itself decide
 * *when* a session counts as "explicitly closed" vs "abandoned" — there is
 * no frontend counter to test here. See
 * `src-tauri/src/terminal/service.rs`'s `TerminalLifecycleMarkerStore` doc
 * comment for why that bookkeeping had to move server-side: this app's
 * Workbench `IStorageService` is registered as the vendor default
 * `InMemoryStorageService` (`app/services.ts` never installs a
 * `@codingame/monaco-vscode-storage-service-override`, consistent with this
 * codebase's "Rust owns persistence" rule — see `AGENTS.md`'s "原生服务规则"),
 * so it cannot survive so much as a page reload, let alone a crash; and a
 * value the WebView wrote into its own `localStorage` instead would be
 * *shared* across every window of the app (same origin, same storage
 * partition — F170 S4's own "动态窗口首次 snapshot 固定 empty，不读取全局
 * last roots" precedent exists precisely to avoid this class of leak), which
 * would make one window's fresh mount misreport another window's still-
 * legitimately-running sessions as "not restorable". Only Rust — which
 * already tracks exactly which sessions are live per window — can correctly
 * attribute this marker; see `TerminalService::claim_lifecycle_marker`'s own
 * doc comment for the full read-then-clear contract this text
 * describes the outcome of.
 */

/**
 * The real exit-banner text for a pane whose shell process has just exited
 * on its own (not via an explicit user close — see `TerminalPaneController`'s
 * own doc comment for why `dispose()` already makes that distinction moot at
 * the listener level). `signal === null` means a normal exit, in which case
 * `exitCode` is the process's own real exit status; a non-`null` `signal`
 * means the process was terminated by a signal, in which case `exitCode`
 * alone is not meaningful on its own — see `TerminalExitEvent.signal`'s own
 * doc comment for why (`portable_pty::ExitStatus::exit_code()` is hardcoded
 * to `1` whenever a signal is set).
 */
export function formatTerminalExitStatus(
	exitCode: number,
	signal: string | null,
): string {
	const outcome =
		signal === null
			? `exited with code ${exitCode}`
			: `was terminated (${signal})`;
	return `The shell process ${outcome}. This session has ended and cannot be resumed — close this pane when you are done with it.`;
}

/**
 * The one-time "last run's terminals could not be restored" notice text —
 * shown by a freshly mounted terminal view's empty state exactly once, only
 * when `PlainBridge.terminalLifecycleMarker` reports a nonzero count (see
 * that method's own doc comment for when that happens: an abnormal reload
 * or crash, never a normal explicit close). `count` is always a positive
 * integer in practice (a `0` marker means no notice is shown at all — see
 * the view's own call site), but this function does not itself enforce
 * that; it only ever needs to format an already-validated count.
 */
export function formatTerminalNonRestorableNotice(count: number): string {
	const sessions = count === 1 ? "terminal session" : "terminal sessions";
	return `${count} previous ${sessions} ended without being explicitly closed and could not be restored.`;
}
