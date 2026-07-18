import { IVoiceTranscriptTurn, IVoiceTranscriptIndexEntry } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/agentsVoice/common/voiceTranscriptStore";
export declare const IVoiceTranscriptStore: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IVoiceTranscriptStore>;
export interface IVoiceTranscriptStore {
    readonly _serviceBrand: undefined;
    /**
    * Append a committed (final) turn to the user's transcript. Writes are
    * serialized via a queue so concurrent calls preserve ordering.
    */
    appendTurn(userId: string, turn: IVoiceTranscriptTurn): Promise<void>;
    /**
    * Load turns for a user in chronological order. Optional time / count filters.
    */
    loadTurns(userId: string, opts?: {
        since?: string;
        limit?: number;
    }): Promise<IVoiceTranscriptTurn[]>;
    /**
    * Index entry for one user (undefined if no turns have ever been persisted).
    */
    getIndexEntry(userId: string): IVoiceTranscriptIndexEntry | undefined;
    /**
    * Hide all turns with ``timestamp < cutoff`` from the default UI view.
    * Non-destructive — the JSONL is untouched.
    */
    archiveUpTo(userId: string, cutoff: string): Promise<void>;
    /** Clear the archive cutoff so all turns are visible again. */
    unarchive(userId: string): Promise<void>;
    /**
    * Permanently delete a user's transcript JSONL and index entry.
    */
    deleteAll(userId: string): Promise<void>;
}
