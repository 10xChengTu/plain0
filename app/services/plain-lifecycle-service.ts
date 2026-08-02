import { CancellationTokenSource } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { ILogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service";
import { WillSaveStateReason } from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage";
import {
	IStorageService as IStorageServiceId,
	type IStorageService,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage.service";
import {
	ShutdownReason,
	WillShutdownJoinerOrder,
	type BeforeShutdownErrorEvent,
	type IWillShutdownEventJoiner,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle";
import { AbstractLifecycleService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycleService";

import type {
	NativeCloseRequest,
	PlainBridge,
} from "../platform/tauri/contracts";

const BEFORE_AND_STORAGE_BUDGET_MS = 4_000;
const WILL_SHUTDOWN_BUDGET_MS = 500;

let configuredBridge: PlainBridge | undefined;

export function configurePlainLifecycleBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

function requireBridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"PlainLifecycleService was used before configurePlainLifecycleBridge",
		);
	}
	return configuredBridge;
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const handle = setTimeout(
			() => reject(new Error("Native close preparation timed out.")),
			milliseconds,
		);
		void promise.then(resolve, reject).finally(() => clearTimeout(handle));
	});
}

export class PlainLifecycleService extends AbstractLifecycleService {
	private activeRequestId: string | undefined;

	constructor(logService: ILogService, storageService: IStorageService) {
		super(logService, storageService);
		void requireBridge()
			.onNativeCloseRequested((request) => {
				void this.onNativeCloseRequest(request).catch((error) =>
					this.logService.error(toError(error)),
				);
			})
			.then((unlisten) => {
				this._register(toDisposable(() => void unlisten()));
			})
			.catch((error) => this.logService.error(toError(error)));
	}

	override shutdown(): Promise<void> {
		return requireBridge().lifecycleRequestClose();
	}

	private async onNativeCloseRequest(
		request: NativeCloseRequest,
	): Promise<void> {
		if (this.activeRequestId !== undefined) {
			await requireBridge().lifecycleCompleteClose(request.requestId, "veto");
			return;
		}
		this.activeRequestId = request.requestId;
		const reason =
			request.reason === "quit" ? ShutdownReason.QUIT : ShutdownReason.CLOSE;
		this.shutdownReason = reason;
		try {
			const veto = await deadline(
				this.handleBeforeShutdown(reason).then(async (beforeVeto) => {
					if (beforeVeto) return true;
					await this.storageService.flush(WillSaveStateReason.SHUTDOWN);
					return false;
				}),
				Math.min(BEFORE_AND_STORAGE_BUDGET_MS, request.timeoutMs - 750),
			);
			if (veto) {
				this.shutdownReason = undefined;
				this._onShutdownVeto.fire();
				await requireBridge().lifecycleCompleteClose(request.requestId, "veto");
				return;
			}

			await this.handleWillShutdown(reason, WILL_SHUTDOWN_BUDGET_MS);
			this._onDidShutdown.fire();
			await requireBridge().lifecycleCompleteClose(request.requestId, "allow");
		} catch (error) {
			this.shutdownReason = undefined;
			this.handleBeforeShutdownError(error, reason);
			this._onShutdownVeto.fire();
			try {
				await requireBridge().lifecycleCompleteClose(request.requestId, "veto");
			} catch (completionError) {
				this.logService.error(toError(completionError));
			}
		} finally {
			this.activeRequestId = undefined;
		}
	}

	private async handleBeforeShutdown(reason: ShutdownReason): Promise<boolean> {
		const vetos: Array<boolean | Promise<boolean>> = [];
		let finalVeto: (() => boolean | Promise<boolean>) | undefined;
		this._onBeforeShutdown.fire({
			reason,
			veto(value) {
				vetos.push(value);
			},
			finalVeto(value) {
				if (finalVeto !== undefined) {
					throw new Error("A final shutdown veto is already registered.");
				}
				finalVeto = value;
			},
		});

		for (const result of await Promise.allSettled(
			vetos.map((value) => Promise.resolve(value)),
		)) {
			if (result.status === "rejected") {
				this.handleBeforeShutdownError(result.reason, reason);
				return true;
			}
			if (result.value) return true;
		}
		if (finalVeto === undefined) return false;
		try {
			return await finalVeto();
		} catch (error) {
			this.handleBeforeShutdownError(error, reason);
			return true;
		}
	}

	private async handleWillShutdown(
		reason: ShutdownReason,
		budgetMs: number,
	): Promise<void> {
		this._willShutdown = true;
		const pending = new Set<IWillShutdownEventJoiner>();
		const regular: Promise<void>[] = [];
		const last: Array<() => Promise<void>> = [];
		const cancellation = new CancellationTokenSource();
		this._onWillShutdown.fire({
			reason,
			token: cancellation.token,
			joiners: () => [...pending],
			join(promiseOrFactory, joiner) {
				pending.add(joiner);
				if (joiner.order === WillShutdownJoinerOrder.Last) {
					const factory =
						typeof promiseOrFactory === "function"
							? promiseOrFactory
							: () => promiseOrFactory;
					last.push(() => factory().finally(() => pending.delete(joiner)));
				} else {
					const promise =
						typeof promiseOrFactory === "function"
							? promiseOrFactory()
							: promiseOrFactory;
					regular.push(promise.finally(() => pending.delete(joiner)));
				}
			},
			force: () => cancellation.cancel(),
		});

		const started = performance.now();
		try {
			await deadline(
				Promise.allSettled(regular).then(() => undefined),
				budgetMs,
			);
			const remaining = Math.max(1, budgetMs - (performance.now() - started));
			await deadline(
				Promise.allSettled(last.map((factory) => factory())).then(
					() => undefined,
				),
				remaining,
			);
		} catch (error) {
			cancellation.cancel();
			this.logService.warn(toError(error).message);
		} finally {
			cancellation.dispose();
		}
	}

	private handleBeforeShutdownError(
		error: unknown,
		reason: ShutdownReason,
	): void {
		const resolved = toError(error);
		this.logService.error(resolved);
		this._onBeforeShutdownError.fire(
			Object.freeze({
				reason,
				error: resolved,
			}) satisfies BeforeShutdownErrorEvent,
		);
	}
}

Object.freeze(PlainLifecycleService.prototype);

ILogService(PlainLifecycleService, undefined, 0);
IStorageServiceId(PlainLifecycleService, undefined, 1);
