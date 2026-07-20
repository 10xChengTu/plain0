import {
	expect,
	test,
	type ConsoleMessage,
	type Dialog,
	type Locator,
	type Page,
} from "@playwright/test";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

interface TestTauriInvocation {
	readonly command: string;
	readonly args: Record<string, unknown>;
}

const nativeWorkspaceId = "00000000-0000-4000-8000-000000000001";
const nativeRootId = "00000000-0000-4000-8000-000000000101";
const nativeSecondaryRootId = "00000000-0000-4000-8000-000000000102";
type RawReadTransport = "arrayBuffer" | "numberArray";
type NativeIpcMockMode = "readonly" | "supported";

interface TestWorkspaceWatchExchange {
	readonly callIndex: number;
	readonly request: Readonly<{
		roots: readonly Readonly<{
			rootId: string;
			acknowledgedGeneration: number | null;
		}>[];
	}>;
	readonly result: Readonly<{
		workspaceId: string;
		roots: readonly Readonly<{
			rootId: string;
			generation: number;
			rescanRequired: boolean;
		}>[];
	}>;
}

async function installNativeIpcMock(
	page: Page,
	rawReadTransport: RawReadTransport,
	mode: NativeIpcMockMode = "readonly",
): Promise<void> {
	await page.addInitScript(
		({ goldenRead, mode, rawReadTransport }) => {
			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const workspaceId = "00000000-0000-4000-8000-000000000001";
			const rootId = "00000000-0000-4000-8000-000000000101";
			const emptySnapshot = {
				workspaceId,
				revision: 0,
				roots: [],
			};
			const selectedSnapshot = {
				workspaceId,
				revision: 1,
				roots: [
					{
						rootId,
						displayName: "native-workspace",
						uri: `plain-workspace://${rootId}/`,
					},
				],
			};
			type MockFile = {
				kind: "file";
				bytes: Uint8Array;
				version: string;
			};
			type MockDirectory = {
				kind: "directory";
				entries: Map<string, MockNode>;
			};
			type MockNode = MockDirectory | MockFile;
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			let versionSerial = 1;
			const nextVersion = (): string =>
				`wv1:${(versionSerial++).toString(16).padStart(64, "0")}`;
			const file = (content: string): MockFile => ({
				kind: "file",
				bytes: encoder.encode(content),
				version: nextVersion(),
			});
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory => ({ kind: "directory", entries: new Map(entries) });
			const root = directory([
				[
					"README.md",
					file("# Native workspace\n\nRead-only Explorer fixture.\n"),
				],
				["src", directory([["main.ts", file("export const plain = true;\n")]])],
			]);
			const entryNotFound = () => ({
				code: "ENTRY_NOT_FOUND",
				message: "The workspace entry does not exist.",
			});
			const entryAlreadyExists = () => ({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
			const entryTypeMismatch = () => ({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
			const invalidDeletePlan = () => ({
				code: "WORKSPACE_DELETE_PLAN_INVALID",
				message: "The workspace delete plan is invalid.",
			});
			const pathSegments = (relativePath: string): readonly string[] =>
				relativePath.length === 0 ? [] : relativePath.split("/");
			const resolveNode = (relativePath: string): MockNode => {
				let node: MockNode = root;
				for (const segment of pathSegments(relativePath)) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					const child = node.entries.get(segment);
					if (child === undefined) {
						throw entryNotFound();
					}
					node = child;
				}
				return node;
			};
			const resolveParent = (
				relativePath: string,
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parentPath = segments.slice(0, -1).join("/");
				const parent = resolveNode(parentPath);
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
			};
			const deleteNode = (relativePath: string): void => {
				const { parent, name } = resolveParent(relativePath);
				if (!parent.entries.delete(name)) {
					throw entryNotFound();
				}
			};
			const descendantEntries = (node: MockNode): number => {
				if (node.kind === "file") {
					return 0;
				}
				let descendants = node.entries.size;
				for (const child of node.entries.values()) {
					descendants += descendantEntries(child);
				}
				return descendants;
			};
			const bytesFromHex = (hex: string): Uint8Array => {
				const bytes = new Uint8Array(hex.length / 2);
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = Number.parseInt(
						hex.slice(index * 2, index * 2 + 2),
						16,
					);
				}
				return bytes;
			};
			const hexFromBytes = (bytes: Uint8Array): string =>
				[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			const plw1Frame = (value: Uint8Array) => {
				if (
					value.byteLength < 14 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x57 ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PLW1 browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const rootLength = view.getUint16(4, false);
				const pathLength = view.getUint16(6, false);
				const versionLength = view.getUint16(8, false);
				const contentLength = view.getUint32(10, false);
				const expectedLength =
					14 + rootLength + pathLength + versionLength + contentLength;
				if (expectedLength !== value.byteLength) {
					throw new Error("Malformed PLW1 browser test frame length.");
				}
				let offset = 14;
				const rootId = decoder.decode(value.slice(offset, offset + rootLength));
				offset += rootLength;
				const relativePath = decoder.decode(
					value.slice(offset, offset + pathLength),
				);
				offset += pathLength;
				const expectedVersion = decoder.decode(
					value.slice(offset, offset + versionLength),
				);
				offset += versionLength;
				const content = value.slice(offset, offset + contentLength);
				return {
					rootId,
					relativePath,
					expectedVersion,
					content,
				};
			};
			const plr1Frame = (
				content: Uint8Array,
				mtime: number,
				ctime: number,
				version: string | null,
			): Uint8Array => {
				const versionBytes =
					version === null
						? new Uint8Array()
						: new TextEncoder().encode(version);
				const frame = new Uint8Array(
					36 + versionBytes.byteLength + content.byteLength,
				);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x52, 0x31], 0);
				frame[4] = 1;
				frame[5] = versionBytes.byteLength;
				view.setUint16(6, 0, false);
				view.setUint32(8, content.byteLength, false);
				view.setBigUint64(12, BigInt(content.byteLength), false);
				view.setBigUint64(20, BigInt(mtime), false);
				view.setBigUint64(28, BigInt(ctime), false);
				frame.set(versionBytes, 36);
				frame.set(content, 36 + versionBytes.byteLength);
				return frame;
			};
			const reproducedGolden = plr1Frame(
				bytesFromHex(goldenRead.contentHex),
				goldenRead.mtimeMs,
				goldenRead.ctimeMs,
				goldenRead.version,
			);
			if (hexFromBytes(reproducedGolden) !== goldenRead.frameHex) {
				throw new Error(
					"Shared PLR1 browser fixture does not reproduce exactly.",
				);
			}
			let deleteSerial = 201;
			const nextDeleteId = (): string =>
				`00000000-0000-4000-8000-${(deleteSerial++)
					.toString()
					.padStart(12, "0")}`;
			let activeDelete:
				| {
						confirmationId: string;
						entryId: string;
						relativePath: string;
						recursive: boolean;
						phase: "prepared" | "executing";
				  }
				| undefined;
			let nextCallbackId = 0;
			let nextEventId = 0;
			const callbacks = new Map<
				number,
				{ callback: (payload: unknown) => void; once: boolean }
			>();
			const eventHandlers = new Map<
				number,
				{ event: string; handlerId: number }
			>();
			let watchNextGeneration = 1;
			let watchPending:
				| { rootId: string; generation: number; rescanRequired: boolean }
				| undefined;
			let watchDirty = false;
			let watchDirtyRescanRequired = false;
			const promoteWatchDirty = (): void => {
				if (watchPending !== undefined || !watchDirty) {
					return;
				}
				watchPending = {
					rootId,
					generation: watchNextGeneration,
					rescanRequired: watchDirtyRescanRequired,
				};
				watchNextGeneration = Math.min(0xffff_ffff, watchNextGeneration + 1);
				watchDirty = false;
				watchDirtyRescanRequired = false;
			};
			const emitWatchWake = (): void => {
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://workspace-watch-wake") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					transformed?.callback({
						event: registration.event,
						id: eventId,
						payload: { workspaceId },
					});
					if (transformed?.once === true) {
						callbacks.delete(registration.handlerId);
					}
				}
			};
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
				__TAURI_EVENT_PLUGIN_INTERNALS__: {
					unregisterListener(): void;
				};
				__TAURI_INTERNALS__: {
					invoke(
						command: string,
						args?: Record<string, unknown> | Uint8Array,
					): Promise<unknown>;
					transformCallback(
						callback?: (payload: unknown) => void,
						once?: boolean,
					): number;
					unregisterCallback(callbackId: number): void;
				};
			};
			testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
			testWindow.__PLAIN_TEST_EXTERNAL_CREATE__ = (name, shouldEmitWake) => {
				if (
					!/^[A-Za-z0-9._-]+$/u.test(name) ||
					root.entries.has(name) ||
					typeof shouldEmitWake !== "boolean"
				) {
					throw new Error("Invalid external workspace test change.");
				}
				root.entries.set(name, file(`external:${name}\n`));
				watchDirty = true;
				promoteWatchDirty();
				if (shouldEmitWake) {
					emitWatchWake();
				}
			};
			testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
				unregisterListener() {},
			};
			testWindow.__TAURI_INTERNALS__ = {
				transformCallback(callback, once = false) {
					nextCallbackId += 1;
					if (callback !== undefined) {
						callbacks.set(nextCallbackId, { callback, once });
					}
					return nextCallbackId;
				},
				unregisterCallback(callbackId) {
					callbacks.delete(callbackId);
				},
				async invoke(command, args: Record<string, unknown> | Uint8Array = {}) {
					if (command === "workspace_write_file") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLW1 browser test frame.");
						}
						const frame = plw1Frame(args);
						calls.push({
							command,
							args: {
								rawHex: hexFromBytes(args),
								request: {
									rootId: frame.rootId,
									relativePath: frame.relativePath,
									expectedVersion: frame.expectedVersion,
								},
								contentHex: hexFromBytes(frame.content),
							},
						});
						if (frame.rootId !== rootId) {
							throw entryNotFound();
						}
						const node = resolveNode(frame.relativePath);
						if (node.kind !== "file") {
							throw entryTypeMismatch();
						}
						if (node.version !== frame.expectedVersion) {
							throw {
								code: "WORKSPACE_FILE_MODIFIED",
								message: "The workspace file changed since it was read.",
							};
						}
						node.bytes = frame.content.slice();
						node.version = nextVersion();
						return {
							status: "written",
							stat: {
								kind: "file",
								size: node.bytes.byteLength,
								mtime: 1_700_000_000_001,
								ctime: 1_699_999_000_000,
								version: node.version,
							},
						};
					}
					if (args instanceof Uint8Array) {
						throw new Error(`Unexpected raw Tauri test command: ${command}`);
					}
					calls.push({ command, args });
					const request = args.request as
						{ rootId?: string; relativePath?: string } | undefined;
					switch (command) {
						case "plugin:event|listen": {
							const event = args.event;
							const handlerId = args.handler;
							if (typeof event !== "string" || typeof handlerId !== "number") {
								throw new Error("Malformed Tauri event listener request.");
							}
							nextEventId += 1;
							eventHandlers.set(nextEventId, { event, handlerId });
							return nextEventId;
						}
						case "plugin:event|unlisten": {
							const eventId = args.eventId;
							if (typeof eventId === "number") {
								eventHandlers.delete(eventId);
							}
							return undefined;
						}
						case "runtime_info":
							return {
								application: "Plain",
								ipcVersion: 1,
								runtime: "tauri",
							};
						case "workspace_capabilities":
							return {
								create: true,
								renameNoReplace: true,
								copyMove: true,
								delete: mode === "supported",
								versionedWrite: true,
							};
						case "workspace_snapshot":
							return emptySnapshot;
						case "workspace_pick_roots":
							return { status: "selected", snapshot: selectedSnapshot };
						case "workspace_watch_sync": {
							const watchRequest = args.request as
								| {
										roots?: readonly {
											rootId?: string;
											acknowledgedGeneration?: number | null;
										}[];
								  }
								| undefined;
							const watchedRoot = watchRequest?.roots?.[0];
							if (
								watchRequest?.roots?.length !== 1 ||
								watchedRoot?.rootId !== rootId
							) {
								return { workspaceId, roots: [] };
							}
							if (watchedRoot.acknowledgedGeneration === null) {
								if (watchPending === undefined) {
									watchDirty = true;
									watchDirtyRescanRequired = true;
								}
							} else if (
								typeof watchedRoot.acknowledgedGeneration === "number" &&
								watchPending?.generation === watchedRoot.acknowledgedGeneration
							) {
								if (watchedRoot.acknowledgedGeneration === 0xffff_ffff) {
									watchPending.rescanRequired = true;
								} else {
									watchPending = undefined;
								}
							}
							promoteWatchDirty();
							return {
								workspaceId,
								roots: watchPending === undefined ? [] : [watchPending],
							};
						}
						case "workspace_create_file": {
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, file(""));
							return {
								kind: "file",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_create_directory": {
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, directory([]));
							return {
								kind: "directory",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_copy": {
							// The projected Browser workspace has one root, so this fixture
							// intentionally does not fabricate a cross-root workspace_move path.
							const copy = args.request as
								| {
										sourceRootId?: string;
										sourcePath?: string;
										targetRootId?: string;
										targetPath?: string;
								  }
								| undefined;
							if (
								copy === undefined ||
								Object.keys(copy).length !== 4 ||
								copy.sourceRootId !== rootId ||
								copy.targetRootId !== rootId ||
								typeof copy.sourcePath !== "string" ||
								typeof copy.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveNode(copy.sourcePath);
							if (source.kind !== "file") {
								throw entryTypeMismatch();
							}
							const target = resolveParent(copy.targetPath);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							target.parent.entries.set(target.name, {
								kind: "file",
								bytes: source.bytes.slice(),
								version: nextVersion(),
							});
							return null;
						}
						case "workspace_rename": {
							const rename = args.request as
								| {
										rootId?: string;
										sourcePath?: string;
										targetPath?: string;
								  }
								| undefined;
							if (rename?.rootId !== rootId) {
								throw entryNotFound();
							}
							const sourcePath = rename.sourcePath ?? "";
							const targetPath = rename.targetPath ?? "";
							const source = resolveParent(sourcePath);
							const target = resolveParent(targetPath);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							source.parent.entries.delete(source.name);
							target.parent.entries.set(target.name, node);
							return null;
						}
						case "workspace_prepare_delete": {
							const prepare = args.request as
								| {
										entries?: readonly {
											rootId?: string;
											relativePath?: string;
											recursive?: boolean;
										}[];
								  }
								| undefined;
							const entry = prepare?.entries?.[0];
							if (
								prepare?.entries?.length !== 1 ||
								entry?.rootId !== rootId ||
								typeof entry.relativePath !== "string" ||
								entry.recursive !== true
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
								relativePath: entry.relativePath,
								recursive: true,
								phase: "prepared",
							};
							return {
								confirmationId,
								entries: [
									{
										entryId,
										kind: node.kind,
										descendantEntries: descendantEntries(node),
									},
								],
							};
						}
						case "workspace_cancel_delete": {
							const cancel = args.request as
								{ confirmationId?: string } | undefined;
							if (cancel?.confirmationId !== activeDelete?.confirmationId) {
								throw invalidDeletePlan();
							}
							activeDelete = undefined;
							return null;
						}
						case "workspace_begin_delete": {
							const begin = args.request as
								{ confirmationId?: string } | undefined;
							if (
								activeDelete === undefined ||
								begin?.confirmationId !== activeDelete.confirmationId ||
								activeDelete.phase !== "prepared"
							) {
								throw invalidDeletePlan();
							}
							activeDelete.phase = "executing";
							return null;
						}
						case "workspace_commit_delete_entry": {
							const commit = args.request as
								| {
										confirmationId?: string;
										entryId?: string;
										rootId?: string;
										relativePath?: string;
										recursive?: boolean;
								  }
								| undefined;
							if (
								activeDelete?.phase !== "executing" ||
								commit?.confirmationId !== activeDelete.confirmationId ||
								commit.entryId !== activeDelete.entryId ||
								commit.rootId !== rootId ||
								commit.relativePath !== activeDelete.relativePath ||
								commit.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							deleteNode(activeDelete.relativePath);
							activeDelete = undefined;
							return { status: "deleted" };
						}
						case "workspace_stat": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							return {
								kind: node.kind,
								size: node.kind === "file" ? node.bytes.byteLength : 0,
								mtime: 1_700_000_000_000,
								ctime: 1_699_999_000_000,
								version: node.kind === "file" ? node.version : null,
							};
						}
						case "workspace_read_dir": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							if (node.kind !== "directory") {
								throw entryTypeMismatch();
							}
							const entries = [...node.entries]
								.map(([name, child]) => ({ name, kind: child.kind }))
								.sort((left, right) =>
									left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
								);
							return { entries };
						}
						case "workspace_read_file": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							if (node.kind !== "file") {
								throw entryTypeMismatch();
							}
							const frame = plr1Frame(
								node.bytes,
								1_700_000_000_000,
								1_699_999_000_000,
								node.version,
							);
							return rawReadTransport === "arrayBuffer"
								? frame.buffer
								: [...frame];
						}
						default:
							throw new Error(`Unexpected Tauri test command: ${command}`);
					}
				},
			};
		},
		{
			goldenRead: workspaceVersionFixture.read,
			mode,
			rawReadTransport,
		},
	);
}

async function installMultiRootNativeIpcMock(page: Page): Promise<void> {
	await page.addInitScript(
		({ workspaceId, primaryRootId, secondaryRootId }) => {
			type MockFile = Readonly<{
				kind: "file";
				bytes: Uint8Array;
			}>;
			type MockDirectory = Readonly<{
				kind: "directory";
				entries: Map<string, MockNode>;
			}>;
			type MockNode = MockFile | MockDirectory;
			type MockWorkspaceRoot = Readonly<{
				rootId: string;
				displayName: string;
				uri: string;
			}>;
			type WatchRootRequest = Readonly<{
				rootId: string;
				acknowledgedGeneration: number | null;
			}>;
			type WatchPendingRoot = Readonly<{
				rootId: string;
				generation: number;
				rescanRequired: boolean;
			}>;
			type WatchState = {
				nextGeneration: number;
				pending: WatchPendingRoot | undefined;
			};

			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const watchExchanges: Array<{
				callIndex: number;
				request: { roots: WatchRootRequest[] };
				result: { workspaceId: string; roots: WatchPendingRoot[] };
			}> = [];
			const primaryRoot = Object.freeze({
				rootId: primaryRootId,
				displayName: "plain-workspace",
				uri: `plain-workspace://${primaryRootId}/`,
			});
			const secondaryRoot = Object.freeze({
				rootId: secondaryRootId,
				displayName: "plain-library",
				uri: `plain-workspace://${secondaryRootId}/`,
			});
			const encoder = new TextEncoder();
			const file = (content: string): MockFile =>
				Object.freeze({ kind: "file", bytes: encoder.encode(content) });
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory =>
				Object.freeze({ kind: "directory", entries: new Map(entries) });
			const trees = new Map<string, MockDirectory>([
				[
					primaryRootId,
					directory([
						["README.md", file("# Primary workspace\n")],
						["src", directory([])],
					]),
				],
				[
					secondaryRootId,
					directory([
						["notes.txt", file("Secondary workspace\n")],
						["packages", directory([])],
					]),
				],
			]);
			const activeRoots = new Map<string, MockWorkspaceRoot>();
			const watchStates = new Map<string, WatchState>();
			let revision = 0;

			const rootNotAuthorized = () => ({
				code: "ROOT_NOT_AUTHORIZED",
				message: "The workspace root is not authorized.",
			});
			const entryNotFound = () => ({
				code: "ENTRY_NOT_FOUND",
				message: "The workspace entry does not exist.",
			});
			const entryTypeMismatch = () => ({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
			const snapshot = () => ({
				workspaceId,
				revision,
				roots: [...activeRoots.values()],
			});
			const resolveNode = (rootId: string, relativePath: string): MockNode => {
				if (!activeRoots.has(rootId)) {
					throw rootNotAuthorized();
				}
				let node: MockNode | undefined = trees.get(rootId);
				if (node === undefined) {
					throw rootNotAuthorized();
				}
				for (const segment of relativePath === ""
					? []
					: relativePath.split("/")) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					node = node.entries.get(segment);
					if (node === undefined) {
						throw entryNotFound();
					}
				}
				return node;
			};
			const plr1Frame = (content: Uint8Array): Uint8Array => {
				const frame = new Uint8Array(36 + content.byteLength);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x52, 0x31], 0);
				frame[4] = 1;
				frame[5] = 0;
				view.setUint16(6, 0, false);
				view.setUint32(8, content.byteLength, false);
				view.setBigUint64(12, BigInt(content.byteLength), false);
				view.setBigUint64(20, 1_700_000_000_000n, false);
				view.setBigUint64(28, 1_699_999_000_000n, false);
				frame.set(content, 36);
				return frame;
			};

			const callbacks = new Map<
				number,
				{ callback: (payload: unknown) => void; once: boolean }
			>();
			const eventHandlers = new Map<
				number,
				{ event: string; handlerId: number }
			>();
			let nextCallbackId = 0;
			let nextEventId = 0;
			const emitWorkspaceWatchWake = (): number => {
				let delivered = 0;
				for (const [eventId, registration] of eventHandlers) {
					if (registration.event !== "plain://workspace-watch-wake") {
						continue;
					}
					const transformed = callbacks.get(registration.handlerId);
					if (transformed === undefined) {
						continue;
					}
					delivered += 1;
					transformed.callback({
						event: registration.event,
						id: eventId,
						payload: { workspaceId },
					});
					if (transformed.once) {
						callbacks.delete(registration.handlerId);
					}
				}
				return delivered;
			};
			const watchState = (rootId: string): WatchState => {
				let state = watchStates.get(rootId);
				if (state === undefined) {
					state = { nextGeneration: 1, pending: undefined };
					watchStates.set(rootId, state);
				}
				return state;
			};
			const invalidateRoot = (rootId: string): void => {
				if (!activeRoots.has(rootId)) {
					throw rootNotAuthorized();
				}
				const state = watchState(rootId);
				if (state.pending === undefined) {
					state.pending = Object.freeze({
						rootId,
						generation: state.nextGeneration,
						rescanRequired: true,
					});
					state.nextGeneration += 1;
				}
			};

			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: typeof watchExchanges;
				__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
				__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
				): void;
				__TAURI_EVENT_PLUGIN_INTERNALS__: {
					unregisterListener(): void;
				};
				__TAURI_INTERNALS__: {
					invoke(
						command: string,
						args?: Record<string, unknown>,
					): Promise<unknown>;
					transformCallback(
						callback?: (payload: unknown) => void,
						once?: boolean,
					): number;
					unregisterCallback(callbackId: number): void;
				};
			};
			testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
			testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__ = watchExchanges;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__ = emitWorkspaceWatchWake;
			testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__ = () =>
				[...eventHandlers.values()].filter(
					({ event }) => event === "plain://workspace-watch-wake",
				).length;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__ = (rootId, name) => {
				if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
					throw new TypeError("Invalid multi-root browser test entry.");
				}
				const root = resolveNode(rootId, "");
				if (root.kind !== "directory" || root.entries.has(name)) {
					throw entryTypeMismatch();
				}
				root.entries.set(name, file(`external:${name}\n`));
				invalidateRoot(rootId);
				emitWorkspaceWatchWake();
			};
			testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
				unregisterListener() {},
			};
			testWindow.__TAURI_INTERNALS__ = {
				transformCallback(callback, once = false) {
					nextCallbackId += 1;
					if (callback !== undefined) {
						callbacks.set(nextCallbackId, { callback, once });
					}
					return nextCallbackId;
				},
				unregisterCallback(callbackId) {
					callbacks.delete(callbackId);
				},
				async invoke(command, args = {}) {
					calls.push({ command, args: structuredClone(args) });
					switch (command) {
						case "plugin:event|listen": {
							const event = args.event;
							const handlerId = args.handler;
							if (typeof event !== "string" || typeof handlerId !== "number") {
								throw new Error("Malformed Tauri event listener request.");
							}
							nextEventId += 1;
							eventHandlers.set(nextEventId, { event, handlerId });
							return nextEventId;
						}
						case "plugin:event|unlisten": {
							const eventId = args.eventId;
							if (typeof eventId === "number") {
								eventHandlers.delete(eventId);
							}
							return undefined;
						}
						case "runtime_info":
							return {
								application: "Plain",
								ipcVersion: 1,
								runtime: "tauri",
							};
						case "workspace_capabilities":
							return {
								create: false,
								renameNoReplace: false,
								copyMove: false,
								delete: false,
								versionedWrite: false,
							};
						case "workspace_snapshot":
							return snapshot();
						case "workspace_pick_roots": {
							const request = args.request as { mode?: unknown } | undefined;
							if (request?.mode === "replace") {
								if (activeRoots.size !== 0) {
									throw new Error(
										"Unexpected replace-root browser test state.",
									);
								}
								activeRoots.set(primaryRootId, primaryRoot);
								invalidateRoot(primaryRootId);
								revision += 1;
								return { status: "selected", snapshot: snapshot() };
							}
							if (request?.mode === "add") {
								if (activeRoots.size !== 1 || !activeRoots.has(primaryRootId)) {
									throw new Error("Unexpected add-root browser test state.");
								}
								activeRoots.set(secondaryRootId, secondaryRoot);
								invalidateRoot(secondaryRootId);
								revision += 1;
								return { status: "selected", snapshot: snapshot() };
							}
							throw new Error("Unexpected workspace picker mode.");
						}
						case "workspace_remove_root": {
							const request = args.request as { rootId?: unknown } | undefined;
							if (
								typeof request?.rootId !== "string" ||
								!activeRoots.delete(request.rootId)
							) {
								throw rootNotAuthorized();
							}
							watchStates.delete(request.rootId);
							revision += 1;
							return snapshot();
						}
						case "workspace_watch_sync": {
							const request = args.request as
								{ roots?: readonly WatchRootRequest[] } | undefined;
							if (!Array.isArray(request?.roots)) {
								throw new TypeError("Invalid workspace watch test request.");
							}
							const requestRoots = request.roots.map((root) => ({
								rootId: root.rootId,
								acknowledgedGeneration: root.acknowledgedGeneration,
							}));
							const pendingRoots: WatchPendingRoot[] = [];
							for (const root of requestRoots) {
								if (!activeRoots.has(root.rootId)) {
									continue;
								}
								const state = watchState(root.rootId);
								if (
									typeof root.acknowledgedGeneration === "number" &&
									state.pending?.generation === root.acknowledgedGeneration
								) {
									state.pending = undefined;
								}
								if (state.pending !== undefined) {
									pendingRoots.push(state.pending);
								}
							}
							const result = { workspaceId, roots: pendingRoots };
							watchExchanges.push({
								callIndex: calls.length - 1,
								request: { roots: requestRoots },
								result: {
									workspaceId,
									roots: pendingRoots.map((root) => ({ ...root })),
								},
							});
							return result;
						}
						case "workspace_stat":
						case "workspace_read_dir":
						case "workspace_read_file": {
							const request = args.request as
								{ rootId?: unknown; relativePath?: unknown } | undefined;
							if (
								typeof request?.rootId !== "string" ||
								typeof request.relativePath !== "string"
							) {
								throw new TypeError("Invalid workspace entry test request.");
							}
							const node = resolveNode(request.rootId, request.relativePath);
							if (command === "workspace_stat") {
								return {
									kind: node.kind,
									size: node.kind === "file" ? node.bytes.byteLength : 0,
									mtime: 1_700_000_000_000,
									ctime: 1_699_999_000_000,
									version: null,
								};
							}
							if (command === "workspace_read_dir") {
								if (node.kind !== "directory") {
									throw entryTypeMismatch();
								}
								return {
									entries: [...node.entries]
										.map(([name, entry]) => ({ name, kind: entry.kind }))
										.sort((left, right) =>
											left.name < right.name
												? -1
												: left.name > right.name
													? 1
													: 0,
										),
								};
							}
							if (node.kind !== "file") {
								throw entryTypeMismatch();
							}
							return plr1Frame(node.bytes).buffer;
						}
						default:
							throw new Error(
								`Unexpected Tauri multi-root test command: ${command}`,
							);
					}
				},
			};
		},
		{
			workspaceId: nativeWorkspaceId,
			primaryRootId: nativeRootId,
			secondaryRootId: nativeSecondaryRootId,
		},
	);
}

async function installCapabilityFailureIpcMock(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const calls: Array<{
			command: string;
			args: Record<string, unknown>;
		}> = [];
		let nextCallbackId = 0;
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: typeof calls;
			__TAURI_EVENT_PLUGIN_INTERNALS__: {
				unregisterListener(): void;
			};
			__TAURI_INTERNALS__: {
				invoke(
					command: string,
					args?: Record<string, unknown>,
				): Promise<unknown>;
				transformCallback(): number;
				unregisterCallback(): void;
			};
		};
		testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
		testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
			unregisterListener() {},
		};
		testWindow.__TAURI_INTERNALS__ = {
			transformCallback() {
				nextCallbackId += 1;
				return nextCallbackId;
			},
			unregisterCallback() {},
			async invoke(command, args = {}) {
				calls.push({ command, args });
				if (command === "workspace_capabilities") {
					throw {
						code: "CAPABILITY_UNAVAILABLE",
						message: "Workspace capabilities are unavailable.",
					};
				}
				throw new Error(`Unexpected Tauri test command: ${command}`);
			},
		};
	});
}

async function executePaletteCommand(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);

	const command = palette.getByText(label, { exact: true });
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette).toBeHidden();
}

async function expectPaletteCommandHidden(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);
	await expect(palette.getByText(label, { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
}

async function expectPaletteTitleHidden(
	page: Page,
	query: string,
	title: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);
	await expect(
		palette
			.locator(".quick-input-list .monaco-list-row")
			.filter({ hasText: title }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
}

async function removeWorkspaceRootViaPalette(
	page: Page,
	rootLabel: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette
		.locator("input")
		.pressSequentially("Remove Folder from Workspace");
	const command = palette.getByText(
		"Workspaces: Remove Folder from Workspace...",
		{ exact: true },
	);
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette.locator("input")).toHaveAttribute(
		"placeholder",
		"Select workspace folder",
	);
	const root = palette.getByText(rootLabel, { exact: true });
	await expect(root).toHaveCount(1);
	await root.click();
	await expect(palette).toBeHidden();
}

async function openNativeWorkspaceExplorer(page: Page): Promise<Locator> {
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	return explorer;
}

async function explorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<Locator> {
	await item.click({ button: "right" });
	const action = page.getByRole("menuitem", { name: label }).last();
	await expect(action).toBeVisible();
	return action;
}

async function activateExplorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<void> {
	const action = await explorerContextAction(page, item, label);
	// The fixed Workbench menu delays its mouse-up listener. Hover selects the
	// real menu row and Enter exercises the same action without a timed sleep.
	await action.hover();
	await page.keyboard.press("Enter");
	await expect(page.locator(".context-view")).toBeHidden();
}

async function finishExplorerNameInput(
	page: Page,
	name: string,
): Promise<void> {
	const input = page.getByRole("textbox", {
		name: "Type file name. Press Enter to confirm or Escape to cancel.",
		exact: true,
	});
	await expect(input).toBeVisible();
	await input.fill(name);
	await input.press("Enter");
}

const nativeMutationCommands = [
	"workspace_create_file",
	"workspace_create_directory",
	"workspace_rename",
	"workspace_copy",
	"workspace_move",
	"workspace_prepare_delete",
	"workspace_cancel_delete",
	"workspace_begin_delete",
	"workspace_commit_delete_entry",
	"workspace_write_file",
	"workspace_remove_root",
] as const;

const nativeDeleteCommands = [
	"workspace_prepare_delete",
	"workspace_cancel_delete",
	"workspace_begin_delete",
	"workspace_commit_delete_entry",
] as const;

test("fails closed before workspace bootstrap when capabilities are unavailable", async ({
	page,
}) => {
	await installCapabilityFailureIpcMock(page);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"error",
	);
	const workspaceInvocations = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
			command.startsWith("workspace_"),
		);
	});
	expect(workspaceInvocations).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
});

test("adds a second workspace root and replaces it through Workbench actions", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();

	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);

	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("covers the browser multi-root remove lifecycle through Explorer and palette", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(0);

	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expandRoot(primaryRoot);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expandRoot(secondaryRoot);
	const secondaryFile = explorer.getByRole("treeitem", {
		name: "notes.txt",
		exact: true,
	});
	await expect(secondaryFile).toHaveCount(1);

	await expect
		.poll(async () =>
			page.evaluate(
				({ primaryRootId, secondaryRootId }) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					};
					const exchanges = testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__;
					return [primaryRootId, secondaryRootId].every(
						(rootId) =>
							exchanges.some(({ result }) =>
								result.roots.some(
									(root) =>
										root.rootId === rootId &&
										root.generation === 1 &&
										root.rescanRequired,
								),
							) &&
							exchanges.some(({ request }) =>
								request.roots.some(
									(root) =>
										root.rootId === rootId && root.acknowledgedGeneration === 1,
								),
							),
					);
				},
				{
					primaryRootId: nativeRootId,
					secondaryRootId: nativeSecondaryRootId,
				},
			),
		)
		.toBe(true);

	const topologyCallCount = async (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				[
					"workspace_snapshot",
					"workspace_pick_roots",
					"workspace_remove_root",
				].includes(command),
			).length;
		});
	const topologyCallsBeforeGenericProbes = await topologyCallCount();
	for (const [query, title] of [
		["Open Workspace from File", "Open Workspace from File..."],
		["Open Workspace Configuration", "Open Workspace Configuration File"],
		["Close Workspace", "Close Workspace"],
		["Save Workspace As", "Save Workspace As..."],
		["Duplicate As Workspace", "Duplicate As Workspace in New Window"],
	] as const) {
		await expectPaletteTitleHidden(page, query, title);
	}
	expect(await topologyCallCount()).toBe(topologyCallsBeforeGenericProbes);

	await activateExplorerContextAction(
		page,
		secondaryRoot,
		"Remove Folder from Workspace",
	);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(secondaryFile).toHaveCount(0);
	await expect(primaryRoot).toHaveCount(1);
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_remove_root",
				).length;
			}),
		)
		.toBe(1);
	const postSecondaryAcceptanceExchangeStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.length;
	});

	// This is a deterministic fixture-authority invariant. Production Rust root
	// capability revocation is covered by the native contract tests.
	const revokedInvalidation = await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
				): void;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked.txt",
				);
				return undefined;
			} catch (error) {
				return error;
			}
		},
		{ rootId: nativeSecondaryRootId },
	);
	expect(revokedInvalidation).toEqual({
		code: "ROOT_NOT_AUTHORIZED",
		message: "The workspace root is not authorized.",
	});
	const staleWakeDeliveries = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
		};
		return testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__();
	});
	expect(staleWakeDeliveries).toBe(1);
	await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
				): void;
			};
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(rootId, "alive.txt");
		},
		{ rootId: nativeRootId },
	);
	await expect(
		explorer.getByRole("treeitem", { name: "alive.txt", exact: true }),
	).toHaveCount(1);
	await expect
		.poll(async () =>
			page.evaluate(
				({ exchangeStart, rootId }) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					};
					const exchanges =
						testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
							exchangeStart,
						);
					return (
						exchanges.some(
							({ result }) =>
								result.roots.length === 1 &&
								result.roots[0]?.rootId === rootId &&
								result.roots[0].generation === 2 &&
								result.roots[0].rescanRequired,
						) &&
						exchanges.some(
							({ request }) =>
								request.roots.length === 1 &&
								request.roots[0]?.rootId === rootId &&
								request.roots[0].acknowledgedGeneration === 2,
						)
					);
				},
				{
					exchangeStart: postSecondaryAcceptanceExchangeStart,
					rootId: nativeRootId,
				},
			),
		)
		.toBe(true);
	const postRemovalWatchExchanges = await page.evaluate(
		({ exchangeStart }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
			};
			return testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
				exchangeStart,
			);
		},
		{ exchangeStart: postSecondaryAcceptanceExchangeStart },
	);
	for (const exchange of postRemovalWatchExchanges) {
		expect(
			exchange.request.roots.some(
				({ rootId }) => rootId === nativeSecondaryRootId,
			),
		).toBe(false);
		expect(
			exchange.result.roots.some(
				({ rootId }) => rootId === nativeSecondaryRootId,
			),
		).toBe(false);
		expect(JSON.stringify(exchange)).not.toMatch(
			/(?:absolute|canonical|native|relative)path/iu,
		);
	}

	await removeWorkspaceRootViaPalette(page, "plain-workspace");
	await expect(primaryRoot).toHaveCount(0);
	await expect(secondaryRoot).toHaveCount(0);
	await expect(page.getByRole("tree", { name: "Files Explorer" })).toHaveCount(
		0,
	);
	await expect(page.locator("body")).not.toHaveAttribute(
		"data-plain-workspace-projection",
		"reload-required",
	);
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				};
				return testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__();
			}),
		)
		.toBe(0);
	const finalAcceptedWatcherWatermark = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return {
			callCount: testWindow.__PLAIN_TEST_TAURI_CALLS__.length,
			exchangeCount: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.length,
		};
	});
	const finalWakeDeliveries = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
		};
		return testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__();
	});
	expect(finalWakeDeliveries).toBe(0);
	const finalWatcherEvidence = await page.evaluate(
		({ callCount, exchangeCount }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
			};
			return {
				watchCommandsAfterAcceptedEmpty: testWindow.__PLAIN_TEST_TAURI_CALLS__
					.slice(callCount)
					.filter(({ command }) => command === "workspace_watch_sync"),
				watchExchangesAfterAcceptedEmpty:
					testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(
						exchangeCount,
					),
			};
		},
		finalAcceptedWatcherWatermark,
	);
	expect(finalWatcherEvidence.watchCommandsAfterAcceptedEmpty).toEqual([]);
	expect(finalWatcherEvidence.watchExchangesAfterAcceptedEmpty).toEqual([]);
	// Keep the mock authorization state honest without presenting it as native
	// filesystem evidence.
	const finalRootInvalidation = await page.evaluate(
		({ rootId }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
				): void;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked-final.txt",
				);
				return undefined;
			} catch (error) {
				return error;
			}
		},
		{ rootId: nativeRootId },
	);
	expect(finalRootInvalidation).toEqual({
		code: "ROOT_NOT_AUTHORIZED",
		message: "The workspace root is not authorized.",
	});
	await expect(primaryRoot).toHaveCount(0);
	await expect(secondaryRoot).toHaveCount(0);

	await expectPaletteTitleHidden(
		page,
		"Remove Folder from Workspace",
		"Workspaces: Remove Folder from Workspace...",
	);
	await expectPaletteTitleHidden(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially("Open Folder");
	await expect(
		palette.getByText("File: Open Folder...", { exact: true }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();

	const removeRequests = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "workspace_remove_root")
			.map(({ args }) => args.request);
	});
	expect(removeRequests).toEqual([
		{ rootId: nativeSecondaryRootId },
		{ rootId: nativeRootId },
	]);
	const rawWatcherEvidence = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
		};
		return {
			invocations: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_watch_sync",
			),
			exchanges: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__,
		};
	});
	expect(rawWatcherEvidence.invocations.length).toBeGreaterThan(0);
	for (const { args } of rawWatcherEvidence.invocations) {
		expect(Reflect.ownKeys(args)).toEqual(["request"]);
		const request = args.request as { roots: unknown };
		expect(Reflect.ownKeys(request)).toEqual(["roots"]);
		expect(Array.isArray(request.roots)).toBe(true);
		expect((request.roots as unknown[]).length).toBeGreaterThan(0);
		for (const root of request.roots as Record<string, unknown>[]) {
			expect(Reflect.ownKeys(root)).toEqual([
				"rootId",
				"acknowledgedGeneration",
			]);
			expect([nativeRootId, nativeSecondaryRootId]).toContain(root.rootId);
			expect(
				root.acknowledgedGeneration === null ||
					(Number.isSafeInteger(root.acknowledgedGeneration) &&
						(root.acknowledgedGeneration as number) >= 1 &&
						(root.acknowledgedGeneration as number) <= 0xffff_ffff),
			).toBe(true);
		}
	}
	for (const exchange of rawWatcherEvidence.exchanges) {
		expect(Reflect.ownKeys(exchange)).toEqual([
			"callIndex",
			"request",
			"result",
		]);
		expect(Number.isSafeInteger(exchange.callIndex)).toBe(true);
		expect(exchange.callIndex).toBeGreaterThanOrEqual(0);
		expect(Reflect.ownKeys(exchange.result)).toEqual(["workspaceId", "roots"]);
		expect(exchange.result.workspaceId).toBe(nativeWorkspaceId);
		for (const root of exchange.result.roots) {
			expect(Reflect.ownKeys(root)).toEqual([
				"rootId",
				"generation",
				"rescanRequired",
			]);
			expect([nativeRootId, nativeSecondaryRootId]).toContain(root.rootId);
			expect(Number.isSafeInteger(root.generation)).toBe(true);
			expect(root.generation).toBeGreaterThanOrEqual(1);
			expect(root.generation).toBeLessThanOrEqual(0xffff_ffff);
			expect(typeof root.rescanRequired).toBe("boolean");
		}
	}
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

for (const rawReadTransport of ["arrayBuffer", "numberArray"] as const) {
	test(`projects a selected folder into Explorer and opens files via ${rawReadTransport}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		await installNativeIpcMock(page, rawReadTransport);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await page.goto("/");
		await expect(page.locator("body")).toHaveAttribute(
			"data-plain-ready",
			"true",
			{ timeout: 60_000 },
		);
		await expect(
			page.getByRole("treeitem", { name: "README.md", exact: true }),
		).toHaveCount(0);
		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await page.getByRole("tab", { name: /^Explorer / }).click();

		const explorer = page.getByRole("tree", { name: "Files Explorer" });
		await expect(explorer).toBeVisible();
		const readme = explorer.getByRole("treeitem", {
			name: "README.md",
			exact: true,
		});
		await expect(readme).toHaveCount(1);
		await readme.dblclick();
		await expect(
			page.getByRole("tab", { name: /^README\.md(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "Read-only Explorer fixture." }),
		).toBeVisible();

		const src = explorer.getByRole("treeitem", { name: "src", exact: true });
		await src.click();
		await page.keyboard.press("ArrowRight");
		await expect(src).toHaveAttribute("aria-expanded", "true");
		const main = explorer.getByRole("treeitem", {
			name: "main.ts",
			exact: true,
		});
		await expect(main).toHaveCount(1);
		await main.dblclick();
		await expect(
			page.getByRole("tab", { name: /^main\.ts(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "export const plain = true;" }),
		).toBeVisible();

		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await expectPaletteCommandHidden(
			page,
			"Open Workspace from File",
			"Workspaces: Open Workspace from File...",
		);
		await expectPaletteCommandHidden(
			page,
			"Save Workspace As",
			"Workspaces: Save Workspace As...",
		);
		await expectPaletteCommandHidden(
			page,
			"Duplicate As Workspace",
			"Workspaces: Duplicate As Workspace in New Window",
		);

		await expect(
			page.locator(".notifications-toasts .notification-toast"),
		).toHaveCount(0);
		const bootstrapInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			const workspaceInvocations = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command.startsWith("workspace_"),
			);
			return {
				capabilities: workspaceInvocations.filter(
					({ command }) => command === "workspace_capabilities",
				),
				firstTwo: workspaceInvocations.slice(0, 2),
			};
		});
		expect(bootstrapInvocations.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(bootstrapInvocations.firstTwo).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
			{ command: "workspace_snapshot", args: { request: {} } },
		]);
		const workspaceInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_pick_roots",
			);
		});
		expect(workspaceInvocations).toEqual([
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
		]);
		const fileReadInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_read_file",
			);
		});
		const fileReadRequests = fileReadInvocations.map(
			({ args }) =>
				args.request as {
					readonly rootId: string;
					readonly relativePath: string;
				},
		);
		expect(fileReadRequests.map(({ relativePath }) => relativePath)).toEqual(
			expect.arrayContaining(["README.md", "src/main.ts"]),
		);
		expect(
			fileReadRequests.every(({ rootId }) => rootId === nativeRootId),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("refreshes Explorer after watcher wakes and after a lost wake timer pull", async ({
	page,
}) => {
	const errors: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer");
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.some(
					({ command, args }) =>
						command === "plugin:event|listen" &&
						args.event === "plain://workspace-watch-wake",
				);
			}),
		)
		.toBe(true);

	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("external-wake.txt", true);
	});
	await expect(
		explorer.getByRole("treeitem", {
			name: "external-wake.txt",
			exact: true,
		}),
	).toHaveCount(1, { timeout: 5_000 });

	await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_EXTERNAL_CREATE__(name: string, emitWake: boolean): void;
		};
		testWindow.__PLAIN_TEST_EXTERNAL_CREATE__("external-timer.txt", false);
	});
	await expect(
		explorer.getByRole("treeitem", {
			name: "external-timer.txt",
			exact: true,
		}),
	).toHaveCount(1, { timeout: 7_000 });

	const watcherRequests = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__
			.filter(({ command }) => command === "workspace_watch_sync")
			.map(({ args }) => args.request);
	});
	expect(watcherRequests.length).toBeGreaterThanOrEqual(5);
	for (const request of watcherRequests) {
		const roots = (
			request as {
				roots?: readonly {
					rootId?: unknown;
					acknowledgedGeneration?: unknown;
				}[];
			}
		).roots;
		expect(roots).toHaveLength(1);
		expect(roots?.[0]?.rootId).toBe(nativeRootId);
		const acknowledgedGeneration = roots?.[0]?.acknowledgedGeneration;
		expect(
			acknowledgedGeneration === null ||
				(typeof acknowledgedGeneration === "number" &&
					Number.isInteger(acknowledgedGeneration) &&
					acknowledgedGeneration > 0),
		).toBe(true);
		expect(JSON.stringify(request)).not.toMatch(
			/(?:relative|canonical|native)?path/iu,
		);
	}
	expect(errors).toEqual([]);
});

test("routes all-five workspace CRUD, save, rename and permanent delete through native IPC", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	const savedContent = "# Native workspace\n\nSaved by Browser E2E.\n";
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(savedContent);
	const activeTab = page.locator(".tabs-container .tab.active");
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "Saved by Browser E2E." }),
	).toBeVisible();

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");

	await page
		.getByRole("button", { name: "New Folder...", exact: true })
		.click();
	await finishExplorerNameInput(page, "scratch");
	const scratch = explorer.getByRole("treeitem", {
		name: "scratch",
		exact: true,
	});
	await expect(scratch).toBeVisible();

	await src.click();
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "draft.txt");
	const draft = explorer.getByRole("treeitem", {
		name: "draft.txt",
		exact: true,
	});
	await expect(draft).toBeVisible();

	const main = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await main.click();
	await page.keyboard.press("ControlOrMeta+C");
	await scratch.click();
	await page.keyboard.press("ControlOrMeta+V");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_copy",
				).length;
			}),
		)
		.toBe(1);
	await scratch.click();
	await page.keyboard.press("ArrowRight");
	await expect(scratch).toHaveAttribute("aria-expanded", "true");
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="3"]')
			.filter({ hasText: "main.ts" }),
	).toHaveCount(1);

	await scratch.click();
	await page.keyboard.press("Enter");
	await finishExplorerNameInput(page, "renamed");
	await expect(scratch).toHaveCount(0);
	const renamed = explorer.getByRole("treeitem", {
		name: "renamed",
		exact: true,
	});
	await expect(renamed).toBeVisible();

	await renamed.click();
	const cancelDeleteKey = page.keyboard.press("ControlOrMeta+Backspace");
	const permanentDeleteDialog = page.getByRole("dialog");
	await expect(permanentDeleteDialog).toBeVisible();
	await expect(permanentDeleteDialog).toContainText("永久删除“renamed”？");
	await expect(permanentDeleteDialog).toContainText("此操作永久且不可撤销");
	await expect(permanentDeleteDialog).toContainText("不会移入废纸篓");
	await expect(
		permanentDeleteDialog.getByRole("button", {
			name: "永久删除",
			exact: true,
		}),
	).toBeVisible();
	await permanentDeleteDialog
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await cancelDeleteKey;
	await expect(permanentDeleteDialog).toHaveCount(0);
	await expect(renamed).toBeVisible();
	await expect
		.poll(async () =>
			page.evaluate(
				(commands) => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__
						.filter(({ command }) => commands.includes(command))
						.map(({ command }) => command);
				},
				nativeDeleteCommands as readonly string[],
			),
		)
		.toEqual(["workspace_prepare_delete", "workspace_cancel_delete"]);

	await renamed.click();
	const confirmDeleteKey = page.keyboard.press("ControlOrMeta+Backspace");
	await expect(permanentDeleteDialog).toBeVisible();
	await permanentDeleteDialog
		.getByRole("button", { name: "永久删除", exact: true })
		.click();
	await confirmDeleteKey;
	await expect(permanentDeleteDialog).toHaveCount(0);
	await expect(renamed).toHaveCount(0);

	const mutations = await page.evaluate(
		(commands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				commands.includes(command),
			);
		},
		nativeMutationCommands as readonly string[],
	);
	expect(mutations.map(({ command }) => command)).toEqual([
		"workspace_write_file",
		"workspace_create_directory",
		"workspace_create_file",
		"workspace_copy",
		"workspace_rename",
		"workspace_prepare_delete",
		"workspace_cancel_delete",
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
	]);
	const write = mutations[0]!.args;
	expect(write.request).toMatchObject({
		rootId: nativeRootId,
		relativePath: "README.md",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/),
	});
	expect(write.contentHex).toBe(
		[...new TextEncoder().encode(savedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(mutations[1]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/scratch" },
	});
	expect(mutations[2]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/draft.txt" },
	});
	expect(mutations[3]!.args).toEqual({
		request: {
			sourceRootId: nativeRootId,
			sourcePath: "src/main.ts",
			targetRootId: nativeRootId,
			targetPath: "src/scratch/main.ts",
		},
	});
	expect(mutations[4]!.args).toEqual({
		request: {
			rootId: nativeRootId,
			sourcePath: "src/scratch",
			targetPath: "src/renamed",
		},
	});
	for (const prepareMutation of [mutations[5], mutations[7]]) {
		const prepared = prepareMutation!.args.request as {
			readonly entries: readonly {
				readonly rootId: string;
				readonly relativePath: string;
				readonly recursive: boolean;
			}[];
		};
		expect(prepared).toEqual({
			entries: [
				{
					rootId: nativeRootId,
					relativePath: "src/renamed",
					recursive: true,
				},
			],
		});
	}
	const cancel = mutations[6]!.args.request as {
		readonly confirmationId: string;
	};
	const begin = mutations[8]!.args.request as {
		readonly confirmationId: string;
	};
	const commit = mutations[9]!.args.request as {
		readonly confirmationId: string;
		readonly entryId: string;
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	};
	expect(begin.confirmationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(cancel.confirmationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(cancel.confirmationId).not.toBe(begin.confirmationId);
	expect(commit).toMatchObject({
		confirmationId: begin.confirmationId,
		entryId: expect.stringMatching(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		),
		rootId: nativeRootId,
		relativePath: "src/renamed",
		recursive: true,
	});
	expect(commit.entryId).not.toBe(commit.confirmationId);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("keeps the entire provider readonly when one platform capability is false", async ({
	page,
}) => {
	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("This write must stay blocked.");
	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(editor).toContainText("Read-only Explorer fixture.");

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await expect(
		page.getByRole("button", { name: "New File...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(
		page.getByRole("button", { name: "New Folder...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	const rename = await explorerContextAction(page, src, "Rename...");
	await expect(rename).toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");

	const dialogs: string[] = [];
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const consoleWarnings: string[] = [];
	const onDialog = (dialog: Dialog): void => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	};
	const onPageError = (error: Error): void => {
		pageErrors.push(error.message);
	};
	const onConsole = (message: ConsoleMessage): void => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		} else if (message.type() === "warning") {
			consoleWarnings.push(message.text());
		}
	};
	page.on("dialog", onDialog);
	page.on("pageerror", onPageError);
	page.on("console", onConsole);
	try {
		await src.click();
		await page.keyboard.press("ControlOrMeta+Backspace");
		await expect
			.poll(
				() =>
					consoleWarnings.filter((message) =>
						message.includes("The permanent delete selection is invalid."),
					).length,
			)
			.toBe(1);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect
			.poll(async () =>
				page.evaluate(
					(commands) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
							commands.includes(command),
						).length;
					},
					nativeMutationCommands as readonly string[],
				),
			)
			.toBe(0);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}),
		);
		await expect(src).toBeVisible();

		const audit = await page.evaluate(
			(commands) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				const workspaceCalls = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command.startsWith("workspace_"),
				);
				return {
					capabilities: workspaceCalls.filter(
						({ command }) => command === "workspace_capabilities",
					),
					mutations: workspaceCalls.filter(({ command }) =>
						commands.includes(command),
					),
				};
			},
			nativeMutationCommands as readonly string[],
		);
		expect(audit.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(audit.mutations).toEqual([]);
	} finally {
		page.off("dialog", onDialog);
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
	}
	expect(dialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
	expect(consoleWarnings).toHaveLength(1);
	expect(consoleWarnings[0]).toContain(
		"The permanent delete selection is invalid.",
	);
});
