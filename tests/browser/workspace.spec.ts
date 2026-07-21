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

interface TestWorkspaceVersionTransition {
	readonly command: "workspace_copy" | "workspace_move";
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly sourceVersion: string;
	readonly targetRootId: string;
	readonly targetPath: string;
	readonly targetVersion: string;
}

const nativeWorkspaceId = "00000000-0000-4000-8000-000000000001";
const nativeRootId = "00000000-0000-4000-8000-000000000101";
const nativeSecondaryRootId = "00000000-0000-4000-8000-000000000102";
type RawReadTransport = "arrayBuffer" | "numberArray";
type NativeIpcMockMode = "readonly" | "supported";
type TestMultiRootMoveIncompleteScenario = "moveRetained" | "movePartial";

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

interface TestWorkspaceWatchExchangeTiming {
	readonly callIndex: number;
	readonly observedAt: number;
}

interface TestMultiRootExternalCreateTiming {
	readonly rootId: string;
	readonly name: string;
	readonly injectedAt: number;
}

type TestMultiRootWatchAcknowledgements = readonly [
	primary: number,
	secondary: number,
];

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

async function installMultiRootNativeIpcMock(
	page: Page,
	mode: NativeIpcMockMode = "readonly",
	moveIncompleteScenarios: readonly TestMultiRootMoveIncompleteScenario[] = [],
): Promise<void> {
	await page.addInitScript(
		({
			mode,
			moveIncompleteScenarios,
			workspaceId,
			primaryRootId,
			secondaryRootId,
		}) => {
			type MockFile = {
				kind: "file";
				bytes: Uint8Array;
				version: string;
			};
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
				dirty: boolean;
				dirtyRescanRequired: boolean;
			};
			type DeferredExternalCreate = Readonly<{
				rootId: string;
				name: string;
				emitWake: boolean;
				resolve(deliveries: number): void;
				reject(reason: unknown): void;
			}>;

			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const watchExchanges: Array<{
				callIndex: number;
				request: { roots: WatchRootRequest[] };
				result: { workspaceId: string; roots: WatchPendingRoot[] };
			}> = [];
			const watchExchangeTimings: TestWorkspaceWatchExchangeTiming[] = [];
			const externalCreateTimings: TestMultiRootExternalCreateTiming[] = [];
			const versionTransitions: TestWorkspaceVersionTransition[] = [];
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
			const decoder = new TextDecoder();
			const moveIncompletePlan = [...moveIncompleteScenarios];
			let versionSerial = 101;
			let deferredExternalCreate: DeferredExternalCreate | undefined;
			const nextVersion = (): string =>
				`wv1:${(versionSerial++).toString(16).padStart(64, "0")}`;
			const file = (content: string): MockFile => ({
				kind: "file",
				bytes: encoder.encode(content),
				version: nextVersion(),
			});
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory =>
				Object.freeze({ kind: "directory", entries: new Map(entries) });
			const rebindNodeVersions = (node: MockNode): MockNode =>
				node.kind === "file"
					? {
							kind: "file",
							bytes: node.bytes,
							version: nextVersion(),
						}
					: directory(
							[...node.entries].map(([name, child]) => [
								name,
								rebindNodeVersions(child),
							]),
						);
			const secondaryEntries: Array<readonly [string, MockNode]> = [
				["move-source.txt", file("Move across roots.\n")],
				["notes.txt", file("Secondary workspace\n")],
				["packages", directory([])],
			];
			if (moveIncompleteScenarios.includes("movePartial")) {
				secondaryEntries.push([
					"move-partial",
					directory([
						["removed.txt", file("Remove this source child.\n")],
						["kept.txt", file("Keep this source child.\n")],
					]),
				]);
			}
			const trees = new Map<string, MockDirectory>([
				[
					primaryRootId,
					directory([
						["README.md", file("# Primary workspace\n")],
						["copy-source.txt", file("Copy across roots.\n")],
						["src", directory([])],
					]),
				],
				[secondaryRootId, directory(secondaryEntries)],
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
			const assertSupportedMutation = (): void => {
				if (mode !== "supported") {
					throw new Error("Unexpected readonly multi-root mutation.");
				}
			};
			const pathSegments = (relativePath: string): readonly string[] =>
				relativePath === "" ? [] : relativePath.split("/");
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
				for (const segment of pathSegments(relativePath)) {
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
			const resolveParent = (
				rootId: string,
				relativePath: string,
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parent = resolveNode(rootId, segments.slice(0, -1).join("/"));
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
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
					throw new Error("Malformed PLW1 multi-root browser test frame.");
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
				if (
					14 + rootLength + pathLength + versionLength + contentLength !==
					value.byteLength
				) {
					throw new Error(
						"Malformed PLW1 multi-root browser test frame length.",
					);
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
				return {
					rootId,
					relativePath,
					expectedVersion,
					content: value.slice(offset, offset + contentLength),
				};
			};
			const plr1Frame = (content: Uint8Array, version: string): Uint8Array => {
				const versionBytes = encoder.encode(version);
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
				view.setBigUint64(20, 1_700_000_000_000n, false);
				view.setBigUint64(28, 1_699_999_000_000n, false);
				frame.set(versionBytes, 36);
				frame.set(content, 36 + versionBytes.byteLength);
				return frame;
			};
			let deleteSerial = 401;
			const nextDeleteId = (): string =>
				`00000000-0000-4000-8000-${(deleteSerial++)
					.toString()
					.padStart(12, "0")}`;
			let activeDelete:
				| {
						confirmationId: string;
						entryId: string;
						rootId: string;
						relativePath: string;
						recursive: boolean;
						phase: "prepared" | "executing";
				  }
				| undefined;

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
					state = {
						nextGeneration: 1,
						pending: undefined,
						dirty: false,
						dirtyRescanRequired: false,
					};
					watchStates.set(rootId, state);
				}
				return state;
			};
			const promoteWatchPending = (rootId: string, state: WatchState): void => {
				if (state.pending !== undefined || !state.dirty) {
					return;
				}
				const generation = state.nextGeneration;
				state.pending = Object.freeze({
					rootId,
					generation,
					rescanRequired: state.dirtyRescanRequired,
				});
				state.nextGeneration = Math.min(0xffff_ffff, generation + 1);
				state.dirty = false;
				state.dirtyRescanRequired = false;
			};
			const invalidateRoot = (rootId: string): void => {
				if (!activeRoots.has(rootId)) {
					throw rootNotAuthorized();
				}
				const state = watchState(rootId);
				state.dirty = true;
				state.dirtyRescanRequired = true;
				promoteWatchPending(rootId, state);
			};
			const externalCreate = (
				rootId: string,
				name: string,
				emitWake: boolean,
			): number => {
				if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
					throw new TypeError("Invalid multi-root browser test entry.");
				}
				if (typeof emitWake !== "boolean") {
					throw new TypeError("Invalid multi-root browser test wake mode.");
				}
				const root = resolveNode(rootId, "");
				if (root.kind !== "directory" || root.entries.has(name)) {
					throw entryTypeMismatch();
				}
				root.entries.set(name, file(`external:${name}\n`));
				invalidateRoot(rootId);
				externalCreateTimings.push({
					rootId,
					name,
					injectedAt: performance.now(),
				});
				return emitWake ? emitWorkspaceWatchWake() : 0;
			};

			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: typeof watchExchanges;
				__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__: typeof watchExchangeTimings;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__: typeof externalCreateTimings;
				__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__(): number;
				__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): number;
				__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
					rootId: string,
					name: string,
					emitWake: boolean,
				): Promise<number>;
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
			testWindow.__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__ =
				versionTransitions;
			testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__ = watchExchanges;
			testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__ =
				watchExchangeTimings;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__ =
				externalCreateTimings;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__ = emitWorkspaceWatchWake;
			testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__ = () =>
				[...eventHandlers.values()].filter(
					({ event }) => event === "plain://workspace-watch-wake",
				).length;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__ = externalCreate;
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__ = (
				rootId,
				name,
				emitWake,
			) => {
				if (deferredExternalCreate !== undefined) {
					throw new Error(
						"A multi-root browser test change is already queued.",
					);
				}
				if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
					throw new TypeError("Invalid multi-root browser test entry.");
				}
				if (typeof emitWake !== "boolean") {
					throw new TypeError("Invalid multi-root browser test wake mode.");
				}
				return new Promise<number>((resolve, reject) => {
					deferredExternalCreate = Object.freeze({
						rootId,
						name,
						emitWake,
						resolve,
						reject,
					});
				});
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
							throw new Error("Expected one raw PLW1 multi-root frame.");
						}
						assertSupportedMutation();
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
						const node = resolveNode(frame.rootId, frame.relativePath);
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
								create: mode === "supported",
								renameNoReplace: mode === "supported",
								copyMove: mode === "supported",
								delete: mode === "supported",
								versionedWrite: mode === "supported",
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
							if (activeDelete?.rootId === request.rootId) {
								activeDelete = undefined;
							}
							revision += 1;
							return snapshot();
						}
						case "workspace_watch_sync": {
							const request = args.request as
								{ roots?: readonly unknown[] } | null | undefined;
							if (
								typeof request !== "object" ||
								request === null ||
								Array.isArray(request) ||
								Reflect.ownKeys(request).length !== 1 ||
								!Object.hasOwn(request, "roots") ||
								!Array.isArray(request.roots) ||
								request.roots.length < 1 ||
								request.roots.length > 256
							) {
								throw new TypeError("Invalid workspace watch test request.");
							}
							const uniqueRootIds = new Set<string>();
							const requestRoots = request.roots.map((candidate) => {
								if (
									typeof candidate !== "object" ||
									candidate === null ||
									Array.isArray(candidate)
								) {
									throw new TypeError("Invalid workspace watch test root.");
								}
								const root = candidate as Record<string, unknown>;
								const rootKeys = Reflect.ownKeys(root);
								if (
									rootKeys.length !== 2 ||
									!Object.hasOwn(root, "rootId") ||
									!Object.hasOwn(root, "acknowledgedGeneration") ||
									typeof root.rootId !== "string" ||
									!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
										root.rootId,
									) ||
									(root.acknowledgedGeneration !== null &&
										(typeof root.acknowledgedGeneration !== "number" ||
											!Number.isSafeInteger(root.acknowledgedGeneration) ||
											root.acknowledgedGeneration < 1 ||
											root.acknowledgedGeneration > 0xffff_ffff)) ||
									uniqueRootIds.has(root.rootId)
								) {
									throw new TypeError("Invalid workspace watch test root.");
								}
								uniqueRootIds.add(root.rootId);
								return {
									rootId: root.rootId,
									acknowledgedGeneration: root.acknowledgedGeneration,
								} satisfies WatchRootRequest;
							});
							const pendingRoots: WatchPendingRoot[] = [];
							for (const root of requestRoots) {
								if (!activeRoots.has(root.rootId)) {
									continue;
								}
								const state = watchState(root.rootId);
								if (
									root.acknowledgedGeneration === null &&
									state.pending === undefined
								) {
									state.dirty = true;
									state.dirtyRescanRequired = true;
								} else if (
									state.pending?.generation === root.acknowledgedGeneration
								) {
									if (root.acknowledgedGeneration === 0xffff_ffff) {
										state.pending = Object.freeze({
											...state.pending,
											rescanRequired: true,
										});
									} else {
										state.pending = undefined;
									}
								}
								promoteWatchPending(root.rootId, state);
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
							watchExchangeTimings.push({
								callIndex: calls.length - 1,
								observedAt: performance.now(),
							});
							const deferred = deferredExternalCreate;
							if (deferred !== undefined) {
								deferredExternalCreate = undefined;
								try {
									deferred.resolve(
										externalCreate(
											deferred.rootId,
											deferred.name,
											deferred.emitWake,
										),
									);
								} catch (error) {
									deferred.reject(error);
								}
							}
							return result;
						}
						case "workspace_create_file":
						case "workspace_create_directory": {
							assertSupportedMutation();
							const request = args.request as
								{ rootId?: unknown; relativePath?: unknown } | undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 2 ||
								typeof request.rootId !== "string" ||
								typeof request.relativePath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const target = resolveParent(
								request.rootId,
								request.relativePath,
							);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const kind =
								command === "workspace_create_file" ? "file" : "directory";
							target.parent.entries.set(
								target.name,
								kind === "file" ? file("") : directory([]),
							);
							return {
								kind,
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_copy": {
							assertSupportedMutation();
							const request = args.request as
								| {
										sourceRootId?: unknown;
										sourcePath?: unknown;
										targetRootId?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 4 ||
								typeof request.sourceRootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetRootId !== "string" ||
								typeof request.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveNode(
								request.sourceRootId,
								request.sourcePath,
							);
							if (source.kind !== "file") {
								throw entryTypeMismatch();
							}
							const target = resolveParent(
								request.targetRootId,
								request.targetPath,
							);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const copiedNode: MockFile = {
								kind: "file",
								bytes: source.bytes.slice(),
								version: nextVersion(),
							};
							target.parent.entries.set(target.name, copiedNode);
							versionTransitions.push({
								command: "workspace_copy",
								sourceRootId: request.sourceRootId,
								sourcePath: request.sourcePath,
								sourceVersion: source.version,
								targetRootId: request.targetRootId,
								targetPath: request.targetPath,
								targetVersion: copiedNode.version,
							});
							return null;
						}
						case "workspace_rename": {
							assertSupportedMutation();
							const request = args.request as
								| {
										rootId?: unknown;
										sourcePath?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 3 ||
								typeof request.rootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveParent(request.rootId, request.sourcePath);
							const target = resolveParent(request.rootId, request.targetPath);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							target.parent.entries.set(target.name, rebindNodeVersions(node));
							source.parent.entries.delete(source.name);
							return null;
						}
						case "workspace_move": {
							assertSupportedMutation();
							const request = args.request as
								| {
										sourceRootId?: unknown;
										sourcePath?: unknown;
										targetRootId?: unknown;
										targetPath?: unknown;
								  }
								| undefined;
							if (
								request === undefined ||
								Object.keys(request).length !== 4 ||
								typeof request.sourceRootId !== "string" ||
								typeof request.sourcePath !== "string" ||
								typeof request.targetRootId !== "string" ||
								typeof request.targetPath !== "string" ||
								request.sourceRootId === request.targetRootId
							) {
								throw entryTypeMismatch();
							}
							const source = resolveParent(
								request.sourceRootId,
								request.sourcePath,
							);
							const target = resolveParent(
								request.targetRootId,
								request.targetPath,
							);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							const plannedIncomplete = moveIncompletePlan[0];
							if (
								plannedIncomplete === "moveRetained" &&
								(request.sourceRootId !== secondaryRootId ||
									request.sourcePath !== "move-source.txt" ||
									request.targetRootId !== primaryRootId ||
									request.targetPath !== "src/move-source.txt")
							) {
								throw new Error(
									"Unexpected retained move browser test request.",
								);
							}
							if (
								plannedIncomplete === "movePartial" &&
								(request.sourceRootId !== secondaryRootId ||
									request.sourcePath !== "move-partial" ||
									request.targetRootId !== primaryRootId ||
									request.targetPath !== "src/move-partial")
							) {
								throw new Error(
									"Unexpected partial move browser test request.",
								);
							}
							const reboundNode = rebindNodeVersions(node);
							target.parent.entries.set(target.name, reboundNode);
							if (node.kind === "file" && reboundNode.kind === "file") {
								versionTransitions.push({
									command: "workspace_move",
									sourceRootId: request.sourceRootId,
									sourcePath: request.sourcePath,
									sourceVersion: node.version,
									targetRootId: request.targetRootId,
									targetPath: request.targetPath,
									targetVersion: reboundNode.version,
								});
							}
							if (plannedIncomplete === "moveRetained") {
								moveIncompletePlan.shift();
								return {
									status: "targetPublishedSourceRetained",
									reason: "deleteFailed",
								};
							}
							if (plannedIncomplete === "movePartial") {
								if (node.kind !== "directory") {
									throw entryTypeMismatch();
								}
								const removedEntries = node.entries.delete("removed.txt")
									? 1
									: 0;
								if (removedEntries !== 1 || !node.entries.has("kept.txt")) {
									throw new Error(
										"Invalid partial move browser test source tree.",
									);
								}
								moveIncompletePlan.shift();
								return {
									status: "targetPublishedSourcePartiallyDeleted",
									reason: "deleteFailed",
									removedEntries,
								};
							}
							source.parent.entries.delete(source.name);
							return { status: "moved" };
						}
						case "workspace_prepare_delete": {
							assertSupportedMutation();
							const request = args.request as
								| {
										entries?: readonly {
											rootId?: unknown;
											relativePath?: unknown;
											recursive?: unknown;
										}[];
								  }
								| undefined;
							const entry = request?.entries?.[0];
							if (
								request === undefined ||
								Object.keys(request).length !== 1 ||
								request.entries?.length !== 1 ||
								entry === undefined ||
								Object.keys(entry).length !== 3 ||
								typeof entry.rootId !== "string" ||
								typeof entry.relativePath !== "string" ||
								typeof entry.recursive !== "boolean"
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(entry.rootId, entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
								rootId: entry.rootId,
								relativePath: entry.relativePath,
								recursive: entry.recursive,
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
							assertSupportedMutation();
							const request = args.request as
								{ confirmationId?: unknown } | undefined;
							if (
								typeof request?.confirmationId !== "string" ||
								request.confirmationId !== activeDelete?.confirmationId
							) {
								throw invalidDeletePlan();
							}
							activeDelete = undefined;
							return null;
						}
						case "workspace_begin_delete": {
							assertSupportedMutation();
							const request = args.request as
								{ confirmationId?: unknown } | undefined;
							if (
								activeDelete === undefined ||
								activeDelete.phase !== "prepared" ||
								request?.confirmationId !== activeDelete.confirmationId
							) {
								throw invalidDeletePlan();
							}
							activeDelete.phase = "executing";
							return null;
						}
						case "workspace_commit_delete_entry": {
							assertSupportedMutation();
							const request = args.request as
								| {
										confirmationId?: unknown;
										entryId?: unknown;
										rootId?: unknown;
										relativePath?: unknown;
										recursive?: unknown;
								  }
								| undefined;
							if (
								activeDelete === undefined ||
								activeDelete.phase !== "executing" ||
								request?.confirmationId !== activeDelete.confirmationId ||
								request.entryId !== activeDelete.entryId ||
								request.rootId !== activeDelete.rootId ||
								request.relativePath !== activeDelete.relativePath ||
								request.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							const target = resolveParent(
								activeDelete.rootId,
								activeDelete.relativePath,
							);
							if (!target.parent.entries.delete(target.name)) {
								throw entryNotFound();
							}
							activeDelete = undefined;
							return { status: "deleted" };
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
									version: node.kind === "file" ? node.version : null,
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
							return plr1Frame(node.bytes, node.version).buffer;
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
			mode,
			moveIncompleteScenarios,
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

async function waitForMultiRootWatchBaseline(page: Page): Promise<number> {
	let watermark = -1;
	await expect
		.poll(
			async () => {
				watermark = await page.evaluate(
					({ primaryRootId, secondaryRootId, workspaceId }) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
						};
						const index =
							testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.findIndex(
								({ request, result }) =>
									request.roots.length === 2 &&
									request.roots[0]?.rootId === primaryRootId &&
									request.roots[0].acknowledgedGeneration === 1 &&
									request.roots[1]?.rootId === secondaryRootId &&
									request.roots[1].acknowledgedGeneration === 1 &&
									result.workspaceId === workspaceId &&
									result.roots.length === 0,
							);
						return index + 1;
					},
					{
						primaryRootId: nativeRootId,
						secondaryRootId: nativeSecondaryRootId,
						workspaceId: nativeWorkspaceId,
					},
				);
				return watermark;
			},
			{
				message:
					"both workspace roots should reach generation-one acknowledgement",
				timeout: 5_000,
			},
		)
		.toBeGreaterThan(0);
	return watermark;
}

async function waitForMultiRootWatchTransition(
	page: Page,
	start: number,
	beforeAcknowledgements: TestMultiRootWatchAcknowledgements,
	targetRootId: string,
	generation: number,
	afterAcknowledgements: TestMultiRootWatchAcknowledgements,
	timeout: number,
): Promise<number> {
	let watermark = -1;
	await expect
		.poll(
			async () => {
				watermark = await page.evaluate(
					({
						afterAcknowledgements,
						beforeAcknowledgements,
						generation,
						primaryRootId,
						secondaryRootId,
						start,
						targetRootId,
						workspaceId,
					}) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
						};
						const exchanges =
							testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__;
						const matchesRequest = (
							exchange: TestWorkspaceWatchExchange,
							acknowledgements: TestMultiRootWatchAcknowledgements,
						): boolean =>
							exchange.request.roots.length === 2 &&
							exchange.request.roots[0]?.rootId === primaryRootId &&
							exchange.request.roots[0].acknowledgedGeneration ===
								acknowledgements[0] &&
							exchange.request.roots[1]?.rootId === secondaryRootId &&
							exchange.request.roots[1].acknowledgedGeneration ===
								acknowledgements[1];
						let pendingIndex = -1;
						for (let index = start; index < exchanges.length; index += 1) {
							const exchange = exchanges[index];
							if (
								exchange === undefined ||
								exchange.result.workspaceId !== workspaceId
							) {
								continue;
							}
							if (
								pendingIndex < 0 &&
								matchesRequest(exchange, beforeAcknowledgements) &&
								exchange.result.roots.length === 1 &&
								exchange.result.roots[0]?.rootId === targetRootId &&
								exchange.result.roots[0].generation === generation &&
								exchange.result.roots[0].rescanRequired
							) {
								pendingIndex = index;
								continue;
							}
							if (
								pendingIndex >= 0 &&
								index > pendingIndex &&
								matchesRequest(exchange, afterAcknowledgements) &&
								exchange.result.roots.length === 0
							) {
								return index + 1;
							}
						}
						return -1;
					},
					{
						afterAcknowledgements,
						beforeAcknowledgements,
						generation,
						primaryRootId: nativeRootId,
						secondaryRootId: nativeSecondaryRootId,
						start,
						targetRootId,
						workspaceId: nativeWorkspaceId,
					},
				);
				return watermark;
			},
			{
				message: `workspace watcher should acknowledge ${targetRootId} generation ${generation}`,
				timeout,
			},
		)
		.toBeGreaterThan(0);
	return watermark;
}

async function explorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<Locator> {
	await item.click({ button: "right" });
	const action = page
		.getByRole("menuitem")
		.filter({ has: page.getByText(label, { exact: true }) })
		.last();
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
					emitWake: boolean,
				): number;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked.txt",
					true,
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
					emitWake: boolean,
				): number;
			};
			testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
				rootId,
				"alive.txt",
				true,
			);
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
					emitWake: boolean,
				): number;
			};
			try {
				testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
					rootId,
					"revoked-final.txt",
					true,
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

test("converges both workspace roots after watcher wakes and lost-wake timer pulls", async ({
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

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expandRoot(primaryRoot);
	await expandRoot(secondaryRoot);

	let exchangeWatermark = await waitForMultiRootWatchBaseline(page);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
				};
				return testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__();
			}),
		)
		.toBe(1);

	const phases = [
		{
			rootId: nativeRootId,
			name: "primary-wake.txt",
			emitWake: true,
			generation: 2,
			beforeAcknowledgements: [1, 1],
			afterAcknowledgements: [2, 1],
			transitionTimeout: 1_800,
		},
		{
			rootId: nativeRootId,
			name: "primary-timer.txt",
			emitWake: false,
			generation: 3,
			beforeAcknowledgements: [2, 1],
			afterAcknowledgements: [3, 1],
			transitionTimeout: 7_000,
		},
		{
			rootId: nativeSecondaryRootId,
			name: "secondary-wake.txt",
			emitWake: true,
			generation: 2,
			beforeAcknowledgements: [3, 1],
			afterAcknowledgements: [3, 2],
			transitionTimeout: 1_800,
		},
		{
			rootId: nativeSecondaryRootId,
			name: "secondary-timer.txt",
			emitWake: false,
			generation: 3,
			beforeAcknowledgements: [3, 2],
			afterAcknowledgements: [3, 3],
			transitionTimeout: 7_000,
		},
	] as const satisfies readonly {
		rootId: string;
		name: string;
		emitWake: boolean;
		generation: number;
		beforeAcknowledgements: TestMultiRootWatchAcknowledgements;
		afterAcknowledgements: TestMultiRootWatchAcknowledgements;
		transitionTimeout: number;
	}[];

	for (const phase of phases) {
		const createdEntry = explorer.getByRole("treeitem", {
			name: phase.name,
			exact: true,
		});
		await expect(createdEntry).toHaveCount(0);
		const phaseStart = exchangeWatermark;
		const wakeDeliveries = await page.evaluate(
			async ({ emitWake, name, rootId }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
						rootId: string,
						name: string,
						emitWake: boolean,
					): number;
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
						rootId: string,
						name: string,
						emitWake: boolean,
					): Promise<number>;
				};
				return emitWake
					? testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(
							rootId,
							name,
							emitWake,
						)
					: testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(
							rootId,
							name,
							emitWake,
						);
			},
			phase,
		);
		expect(wakeDeliveries).toBe(phase.emitWake ? 1 : 0);

		exchangeWatermark = await waitForMultiRootWatchTransition(
			page,
			phaseStart,
			phase.beforeAcknowledgements,
			phase.rootId,
			phase.generation,
			phase.afterAcknowledgements,
			phase.transitionTimeout,
		);
		const phaseEvidence = await page.evaluate(
			({ end, generation, name, rootId, start }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__: TestWorkspaceWatchExchange[];
					__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__: TestWorkspaceWatchExchangeTiming[];
					__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__: TestMultiRootExternalCreateTiming[];
				};
				const exchanges =
					testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__.slice(start, end);
				const pendingExchange = exchanges.find(
					({ result }) =>
						result.roots.length === 1 &&
						result.roots[0]?.rootId === rootId &&
						result.roots[0].generation === generation,
				);
				const pendingTiming =
					pendingExchange === undefined
						? undefined
						: testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__.find(
								({ callIndex }) => callIndex === pendingExchange.callIndex,
							);
				const injectionTiming =
					testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__.find(
						(timing) => timing.rootId === rootId && timing.name === name,
					);
				return {
					exchanges,
					invocations: exchanges.map(
						({ callIndex }) => testWindow.__PLAIN_TEST_TAURI_CALLS__[callIndex],
					),
					injectionToPendingMs:
						pendingTiming === undefined || injectionTiming === undefined
							? undefined
							: pendingTiming.observedAt - injectionTiming.injectedAt,
				};
			},
			{
				end: exchangeWatermark,
				generation: phase.generation,
				name: phase.name,
				rootId: phase.rootId,
				start: phaseStart,
			},
		);
		const phaseExchanges = phaseEvidence.exchanges;
		expect(phaseExchanges.length).toBeGreaterThanOrEqual(2);
		expect(phaseEvidence.invocations).toHaveLength(phaseExchanges.length);
		expect(phaseEvidence.injectionToPendingMs).toBeGreaterThanOrEqual(0);
		if (phase.emitWake) {
			expect(phaseEvidence.injectionToPendingMs).toBeLessThan(1_800);
		}
		let pendingCount = 0;
		for (const [index, exchange] of phaseExchanges.entries()) {
			const invocation = phaseEvidence.invocations[index];
			expect(invocation?.command).toBe("workspace_watch_sync");
			expect(Reflect.ownKeys(invocation?.args ?? {})).toEqual(["request"]);
			const rawRequest = invocation?.args.request as
				{ roots?: readonly Record<string, unknown>[] } | undefined;
			expect(Reflect.ownKeys(rawRequest ?? {})).toEqual(["roots"]);
			expect(rawRequest?.roots).toHaveLength(2);
			for (const root of rawRequest?.roots ?? []) {
				expect(Reflect.ownKeys(root)).toEqual([
					"rootId",
					"acknowledgedGeneration",
				]);
			}
			expect(JSON.stringify(invocation)).not.toMatch(
				/(?:absolute|canonical|native|relative|file)?path/iu,
			);
			expect(exchange.result.workspaceId).toBe(nativeWorkspaceId);
			expect(exchange.request.roots).toHaveLength(2);
			expect(exchange.request.roots.map(({ rootId }) => rootId)).toEqual([
				nativeRootId,
				nativeSecondaryRootId,
			]);
			const acknowledgements = exchange.request.roots.map(
				({ acknowledgedGeneration }) => acknowledgedGeneration,
			);
			expect([
				phase.beforeAcknowledgements,
				phase.afterAcknowledgements,
			]).toContainEqual(acknowledgements);
			if (exchange.result.roots.length > 0) {
				pendingCount += 1;
				expect(exchange.result.roots).toEqual([
					{
						rootId: phase.rootId,
						generation: phase.generation,
						rescanRequired: true,
					},
				]);
			}
			expect(JSON.stringify(exchange)).not.toMatch(
				/(?:absolute|canonical|native|relative|file)?path/iu,
			);
		}
		expect(pendingCount).toBeGreaterThanOrEqual(1);
		const acceptedExchange = phaseExchanges.at(-1);
		expect(
			acceptedExchange?.request.roots.map(
				({ acknowledgedGeneration }) => acknowledgedGeneration,
			),
		).toEqual(phase.afterAcknowledgements);
		expect(acceptedExchange?.result.roots).toEqual([]);
		await expect(createdEntry).toHaveCount(1, { timeout: 5_000 });
	}

	const finalEvidence = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(): number;
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		const mutationCommands = new Set([
			"workspace_write_file",
			"workspace_create_file",
			"workspace_create_directory",
			"workspace_rename",
			"workspace_copy",
			"workspace_move",
			"workspace_prepare_delete",
			"workspace_execute_delete",
		]);
		return {
			listenerCount:
				testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__(),
			mutationCalls: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => mutationCommands.has(command),
			),
		};
	});
	expect(finalEvidence.listenerCount).toBe(1);
	expect(finalEvidence.mutationCalls).toEqual([]);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(errors).toEqual([]);
});

test("shows missing-parent create failures for both workspace roots", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported");
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const expandRoot = async (root: Locator): Promise<void> => {
		if ((await root.getAttribute("aria-expanded")) !== "true") {
			await root.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(root).toHaveAttribute("aria-expanded", "true");
	};
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expandRoot(primaryRoot);
	await expandRoot(secondaryRoot);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "notes.txt", exact: true }),
	).toHaveCount(1);

	const callStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
	});
	const createCommandCount = async (command: string): Promise<number> =>
		page.evaluate(
			({ callStart, command }) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__
					.slice(callStart)
					.filter((call) => call.command === command).length;
			},
			{ callStart, command },
		);
	const consumeCreateFailureNotification = async (): Promise<void> => {
		const toasts = page.locator(".notifications-toasts .notification-toast");
		await expect(toasts).toHaveCount(1);
		const toast = toasts.first();
		await expect(toast).toContainText(
			"Unable to create the Plain workspace entry",
		);
		await expect(
			toast.getByRole("button", { name: "Retry", exact: true }),
		).toHaveCount(1);
		const text = await toast.innerText();
		expect(text).not.toContain("ENTRY_NOT_FOUND");
		expect(text).not.toContain(nativeRootId);
		expect(text).not.toContain(nativeSecondaryRootId);
		expect(text).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
		await toast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(toasts).toHaveCount(0);
	};

	await primaryRoot.click();
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "missing-file-parent/new.txt");
	await expect.poll(() => createCommandCount("workspace_create_file")).toBe(1);
	await consumeCreateFailureNotification();
	await expect(
		explorer.getByRole("treeitem", {
			name: "missing-file-parent",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		explorer.getByRole("treeitem", { name: "new.txt", exact: true }),
	).toHaveCount(0);

	await secondaryRoot.click();
	await page
		.getByRole("button", { name: "New Folder...", exact: true })
		.click();
	await finishExplorerNameInput(page, "missing-folder-parent/new-dir");
	await expect
		.poll(() => createCommandCount("workspace_create_directory"))
		.toBe(1);
	await consumeCreateFailureNotification();
	await expect(
		explorer.getByRole("treeitem", {
			name: "missing-folder-parent",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(
		explorer.getByRole("treeitem", { name: "new-dir", exact: true }),
	).toHaveCount(0);

	const evidence = await page.evaluate(
		({ callStart, mutationCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			const calls = testWindow.__PLAIN_TEST_TAURI_CALLS__;
			const callsAfterStart = calls.slice(callStart);
			const missingPrefixes = ["missing-file-parent", "missing-folder-parent"];
			return {
				capabilities: calls.filter(
					({ command }) => command === "workspace_capabilities",
				),
				mutations: callsAfterStart.filter(({ command }) =>
					mutationCommands.includes(command),
				),
				targetReads: callsAfterStart.filter(({ command, args }) => {
					if (
						![
							"workspace_stat",
							"workspace_read_file",
							"workspace_read_dir",
						].includes(command)
					) {
						return false;
					}
					const request = args.request as
						{ relativePath?: unknown } | undefined;
					return (
						typeof request?.relativePath === "string" &&
						missingPrefixes.some(
							(prefix) =>
								request.relativePath === prefix ||
								(request.relativePath as string).startsWith(`${prefix}/`),
						)
					);
				}),
			};
		},
		{
			callStart,
			mutationCommands: nativeMutationCommands as readonly string[],
		},
	);
	expect(evidence.capabilities).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
	expect(evidence.mutations).toEqual([
		{
			command: "workspace_create_file",
			args: {
				request: {
					rootId: nativeRootId,
					relativePath: "missing-file-parent/new.txt",
				},
			},
		},
		{
			command: "workspace_create_directory",
			args: {
				request: {
					rootId: nativeSecondaryRootId,
					relativePath: "missing-folder-parent/new-dir",
				},
			},
		},
	]);
	expect(evidence.targetReads).toEqual([]);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "new.txt" }),
	).toHaveCount(0);
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "README.md", exact: true }),
	).toHaveCount(1);
	await expect(
		explorer.getByRole("treeitem", { name: "notes.txt", exact: true }),
	).toHaveCount(1);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(4);
	for (const diagnostic of consoleErrors) {
		expect(diagnostic).not.toContain("ENTRY_NOT_FOUND");
		expect(diagnostic).not.toContain(nativeRootId);
		expect(diagnostic).not.toContain(nativeSecondaryRootId);
	}
	expect(consoleErrors[0]).toContain("FileServiceOverride.createFile");
	expect(consoleErrors[0]).toContain(
		"FileOperationError: Unable to create the Plain workspace entry",
	);
	expect(consoleErrors[1]).toBe("Unable to create the Plain workspace entry");
	expect(consoleErrors[2]).toContain("FileServiceOverride.createFolder");
	expect(consoleErrors[2]).toContain(
		"FileOperationError: Unable to create the Plain workspace entry",
	);
	expect(consoleErrors[3]).toBe("Unable to create the Plain workspace entry");
});

test("shows retained and partial cross-root move failures", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported", [
		"moveRetained",
		"movePartial",
	]);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("dialog", (dialog) => {
		nativeDialogs.push(dialog.message());
		void dialog.dismiss();
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	const itemAtLevel = (name: string, level: number): Locator =>
		explorer
			.locator(`[role="treeitem"][aria-level="${level}"]`)
			.filter({ hasText: name });
	const expandDirectory = async (directory: Locator): Promise<void> => {
		await expect(directory).toHaveCount(1);
		if ((await directory.getAttribute("aria-expanded")) !== "true") {
			await directory.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(directory).toHaveAttribute("aria-expanded", "true");
	};
	await expandDirectory(primaryRoot);
	await expandDirectory(secondaryRoot);
	const src = itemAtLevel("src", 2);
	await expect(src).toHaveCount(1);

	const callStart = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
	});
	const currentCallCount = (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.length;
		});
	const moveCount = (): Promise<number> =>
		page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_move",
			).length;
		});
	const expectBothRootRefreshes = async (phaseStart: number): Promise<void> => {
		await expect
			.poll(() =>
				page.evaluate(
					({ phaseStart, rootIds }) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						const refreshed = new Set(
							testWindow.__PLAIN_TEST_TAURI_CALLS__
								.slice(phaseStart)
								.filter(({ command, args }) => {
									if (command !== "workspace_read_dir") {
										return false;
									}
									const request = args.request as
										{ rootId?: unknown; relativePath?: unknown } | undefined;
									return (
										request?.relativePath === "" &&
										typeof request.rootId === "string" &&
										rootIds.includes(request.rootId)
									);
								})
								.map(({ args }) => (args.request as { rootId: string }).rootId),
						);
						return rootIds.every((rootId) => refreshed.has(rootId));
					},
					{
						phaseStart,
						rootIds: [nativeRootId, nativeSecondaryRootId],
					},
				),
			)
			.toBe(true);
	};
	const moveMessage =
		"The workspace move published its target but could not remove all of its source.";
	const consumeMoveFailureToast = async (): Promise<void> => {
		const toasts = page.locator(".notifications-toasts .notification-toast");
		await expect(toasts).toHaveCount(1);
		const toast = toasts.first();
		await expect(toast).toContainText(moveMessage);
		await expect(toast).not.toContainText(
			"The file(s) to paste have been deleted or moved since you copied them.",
		);
		await expect(
			toast.getByRole("button", { name: "Retry", exact: true }),
		).toHaveCount(0);
		const text = await toast.innerText();
		expect(text).not.toContain("targetPublishedSource");
		expect(text).not.toContain("deleteFailed");
		expect(text).not.toContain("removedEntries");
		expect(text).not.toContain(nativeRootId);
		expect(text).not.toContain(nativeSecondaryRootId);
		expect(text).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
		await toast.hover();
		await toast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(toasts).toHaveCount(0);
	};
	const cutAndPaste = async (
		source: Locator,
		expectedMoves: number,
	): Promise<number> => {
		const phaseStart = await currentCallCount();
		await activateExplorerContextAction(page, source, "Cut");
		await expect(source.locator(".explorer-item.cut")).toHaveCount(1);
		await activateExplorerContextAction(page, src, "Paste");
		await expect.poll(moveCount).toBe(expectedMoves);
		await consumeMoveFailureToast();
		await expect(source.locator(".explorer-item.cut")).toHaveCount(0);
		await expectBothRootRefreshes(phaseStart);
		return phaseStart;
	};

	const retainedSource = itemAtLevel("move-source.txt", 2);
	await expect(retainedSource).toHaveCount(1);
	await cutAndPaste(retainedSource, 1);
	await expandDirectory(src);
	await expect(itemAtLevel("move-source.txt", 2)).toHaveCount(1);
	await expect(itemAtLevel("move-source.txt", 3)).toHaveCount(1);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "move-source.txt" }),
	).toHaveCount(0);

	const partialSource = itemAtLevel("move-partial", 2);
	await expandDirectory(partialSource);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	await cutAndPaste(partialSource, 2);
	await expandDirectory(src);
	const retainedPartialSource = itemAtLevel("move-partial", 2);
	const publishedPartialTarget = itemAtLevel("move-partial", 3);
	await expandDirectory(retainedPartialSource);
	await expandDirectory(publishedPartialTarget);
	await expect(itemAtLevel("removed.txt", 3)).toHaveCount(0);
	await expect(itemAtLevel("kept.txt", 3)).toHaveCount(1);
	await expect(itemAtLevel("removed.txt", 4)).toHaveCount(1);
	await expect(itemAtLevel("kept.txt", 4)).toHaveCount(1);
	await expect(
		page.locator(".tabs-container .tab").filter({ hasText: "move-partial" }),
	).toHaveCount(0);

	const evidence = await page.evaluate(
		({ callStart, mutationCommands }) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__
				.slice(callStart)
				.filter(({ command }) => mutationCommands.includes(command));
		},
		{
			callStart,
			mutationCommands: nativeMutationCommands as readonly string[],
		},
	);
	expect(evidence).toEqual([
		{
			command: "workspace_move",
			args: {
				request: {
					sourceRootId: nativeSecondaryRootId,
					sourcePath: "move-source.txt",
					targetRootId: nativeRootId,
					targetPath: "src/move-source.txt",
				},
			},
		},
		{
			command: "workspace_move",
			args: {
				request: {
					sourceRootId: nativeSecondaryRootId,
					sourcePath: "move-partial",
					targetRootId: nativeRootId,
					targetPath: "src/move-partial",
				},
			},
		},
	]);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(nativeDialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toHaveLength(4);
	for (const diagnostic of consoleErrors) {
		expect(diagnostic).not.toContain("targetPublishedSource");
		expect(diagnostic).not.toContain("deleteFailed");
		expect(diagnostic).not.toContain("removedEntries");
		expect(diagnostic).not.toContain(nativeRootId);
		expect(diagnostic).not.toContain(nativeSecondaryRootId);
	}
	expect(consoleErrors[0]).toContain("WORKSPACE_MOVE_INCOMPLETE");
	expect(consoleErrors[0]).toContain(moveMessage);
	expect(consoleErrors[1]).toBe(moveMessage);
	expect(consoleErrors[1]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
	expect(consoleErrors[2]).toContain("WORKSPACE_MOVE_INCOMPLETE");
	expect(consoleErrors[2]).toContain(moveMessage);
	expect(consoleErrors[3]).toBe(moveMessage);
	expect(consoleErrors[3]).not.toMatch(/(?:\/Users\/|[A-Za-z]:\\|\\\\)/u);
});

test("edits both roots and routes cross-root copy and move through all-true IPC", async ({
	page,
}) => {
	const errors: string[] = [];
	const nativeDialogs: string[] = [];
	await installMultiRootNativeIpcMock(page, "supported");
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
	await executePaletteCommand(
		page,
		"Add Folder to Workspace",
		"Workspaces: Add Folder to Workspace...",
	);
	const primaryRoot = explorer.getByRole("treeitem", {
		name: "plain-workspace",
		exact: true,
	});
	const secondaryRoot = explorer.getByRole("treeitem", {
		name: "plain-library",
		exact: true,
	});
	await expect(primaryRoot).toHaveCount(1);
	await expect(secondaryRoot).toHaveCount(1);
	const expandDirectory = async (directory: Locator): Promise<void> => {
		if ((await directory.getAttribute("aria-expanded")) !== "true") {
			await directory.click();
			await page.keyboard.press("ArrowRight");
		}
		await expect(directory).toHaveAttribute("aria-expanded", "true");
	};
	await expandDirectory(primaryRoot);
	await expandDirectory(secondaryRoot);

	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	const notes = explorer.getByRole("treeitem", {
		name: "notes.txt",
		exact: true,
	});
	const saveExplorerFile = async (
		entry: Locator,
		initialText: string,
		savedContent: string,
		savedMarker: string,
		expectedWriteCount: number,
	): Promise<void> => {
		await entry.dblclick();
		const editor = page.getByRole("code").filter({ hasText: initialText });
		await expect(editor).toBeVisible();
		await page
			.locator(".monaco-editor .view-line")
			.filter({ hasText: initialText })
			.click();
		await page.keyboard.press("ControlOrMeta+A");
		await page.keyboard.type(savedContent);
		const activeTab = page.locator(".tabs-container .tab.active");
		await page.keyboard.press("ControlOrMeta+S");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const testWindow = window as unknown as Window & {
						__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
					};
					return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
						({ command }) => command === "workspace_write_file",
					).length;
				}),
			)
			.toBe(expectedWriteCount);
		await expect(activeTab).not.toHaveClass(/dirty/);
		await expect(
			page.getByRole("code").filter({ hasText: savedMarker }),
		).toBeVisible();
	};
	const primarySavedContent =
		"# Primary workspace\n\nEdited in the primary root.\n";
	await saveExplorerFile(
		readme,
		"# Primary workspace",
		primarySavedContent,
		"Edited in the primary root.",
		1,
	);
	const secondarySavedContent =
		"Secondary workspace\nEdited in the secondary root.\n";
	await saveExplorerFile(
		notes,
		"Secondary workspace",
		secondarySavedContent,
		"Edited in the secondary root.",
		2,
	);

	const copySource = explorer.getByRole("treeitem", {
		name: "copy-source.txt",
		exact: true,
	});
	const packages = explorer.getByRole("treeitem", {
		name: "packages",
		exact: true,
	});
	await activateExplorerContextAction(page, copySource, "Copy");
	await activateExplorerContextAction(page, packages, "Paste");
	await expect
		.poll(() =>
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
	await expandDirectory(packages);
	const copiedTarget = explorer
		.locator('[role="treeitem"][aria-level="3"]')
		.filter({ hasText: "copy-source.txt" });
	await expect(copiedTarget).toHaveCount(1);
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="2"]')
			.filter({ hasText: "copy-source.txt" }),
	).toHaveCount(1);
	await copiedTarget.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "Copy across roots." }),
	).toBeVisible();

	const moveSource = explorer.getByRole("treeitem", {
		name: "move-source.txt",
		exact: true,
	});
	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	const renameAction = await explorerContextAction(
		page,
		moveSource,
		"Rename...",
	);
	await expect(renameAction).not.toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");
	await expect(page.locator(".context-view")).toBeHidden();
	await moveSource.click();
	await expect(moveSource).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("ControlOrMeta+X");
	await expect(moveSource.locator(".explorer-item.cut")).toHaveCount(1);
	await activateExplorerContextAction(page, src, "Paste");
	await expect
		.poll(() =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_move",
				).length;
			}),
		)
		.toBe(1);
	await expandDirectory(src);
	const movedTarget = explorer
		.locator('[role="treeitem"][aria-level="3"]')
		.filter({ hasText: "move-source.txt" });
	await expect(movedTarget).toHaveCount(1);
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="2"]')
			.filter({ hasText: "move-source.txt" }),
	).toHaveCount(0);
	await movedTarget.dblclick();
	await expect(
		page.getByRole("code").filter({ hasText: "Move across roots." }),
	).toBeVisible();

	const evidence = await page.evaluate(
		(mutationCommands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: TestWorkspaceVersionTransition[];
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return {
				capabilities: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_capabilities",
				),
				mutations: testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
					mutationCommands.includes(command),
				),
				versionTransitions: structuredClone(
					testWindow.__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__,
				),
			};
		},
		nativeMutationCommands as readonly string[],
	);
	expect(evidence.capabilities).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
	expect(evidence.mutations.map(({ command }) => command)).toEqual([
		"workspace_write_file",
		"workspace_write_file",
		"workspace_copy",
		"workspace_move",
	]);
	const [primaryWrite, secondaryWrite, copy, move] = evidence.mutations;
	for (const write of [primaryWrite, secondaryWrite]) {
		expect(Reflect.ownKeys(write!.args)).toEqual([
			"rawHex",
			"request",
			"contentHex",
		]);
		expect(write!.args.rawHex).toEqual(expect.stringMatching(/^504c5731/u));
		expect(Reflect.ownKeys(write!.args.request as object)).toEqual([
			"rootId",
			"relativePath",
			"expectedVersion",
		]);
	}
	expect(primaryWrite!.args.request).toEqual({
		rootId: nativeRootId,
		relativePath: "README.md",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
	});
	expect(primaryWrite!.args.contentHex).toBe(
		[...new TextEncoder().encode(primarySavedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(secondaryWrite!.args.request).toEqual({
		rootId: nativeSecondaryRootId,
		relativePath: "notes.txt",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
	});
	expect(secondaryWrite!.args.contentHex).toBe(
		[...new TextEncoder().encode(secondarySavedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(
		(primaryWrite!.args.request as { expectedVersion: string }).expectedVersion,
	).not.toBe(
		(secondaryWrite!.args.request as { expectedVersion: string })
			.expectedVersion,
	);
	expect(copy!.args).toEqual({
		request: {
			sourceRootId: nativeRootId,
			sourcePath: "copy-source.txt",
			targetRootId: nativeSecondaryRootId,
			targetPath: "packages/copy-source.txt",
		},
	});
	expect(move!.args).toEqual({
		request: {
			sourceRootId: nativeSecondaryRootId,
			sourcePath: "move-source.txt",
			targetRootId: nativeRootId,
			targetPath: "src/move-source.txt",
		},
	});
	expect(evidence.versionTransitions).toEqual([
		{
			command: "workspace_copy",
			sourceRootId: nativeRootId,
			sourcePath: "copy-source.txt",
			sourceVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
			targetRootId: nativeSecondaryRootId,
			targetPath: "packages/copy-source.txt",
			targetVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
		},
		{
			command: "workspace_move",
			sourceRootId: nativeSecondaryRootId,
			sourcePath: "move-source.txt",
			sourceVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
			targetRootId: nativeRootId,
			targetPath: "src/move-source.txt",
			targetVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/u),
		},
	]);
	for (const transition of evidence.versionTransitions) {
		expect(transition.targetVersion).not.toBe(transition.sourceVersion);
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
		const warningToast = page
			.locator(".notifications-toasts .notification-toast")
			.filter({ hasText: "The permanent delete selection is invalid." });
		await expect(warningToast).toHaveCount(1);
		await expect(warningToast).toContainText(
			"The permanent delete selection is invalid.",
		);
		await expect(page.getByRole("dialog")).toHaveCount(1);
		await warningToast.hover();
		await warningToast
			.getByRole("button", {
				name: /^Clear Notification(?: \(.+\))?$/u,
			})
			.click();
		await expect(warningToast).toHaveCount(0);
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
	expect(consoleWarnings).toEqual([]);
});
