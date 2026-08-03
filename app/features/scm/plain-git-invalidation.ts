import { Emitter } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";

/** Product-owned, path-free refresh hint emitted after a Git mutation.
 * Consumers must re-read their own Rust/Git authority; this event never
 * carries optimistic status, refs, native paths, URLs or credentials. */
export interface PlainGitInvalidationEvent {
	readonly rootId: string;
}

class PlainGitInvalidationBus {
	readonly #emitter = new Emitter<PlainGitInvalidationEvent>();
	readonly onDidInvalidate = this.#emitter.event;

	invalidate(rootId: string): void {
		this.#emitter.fire(Object.freeze({ rootId }));
	}
}

export const plainGitInvalidation = new PlainGitInvalidationBus();
