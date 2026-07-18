import { Event } from "../../../../../../base/common/event.js";
import { URI } from "../../../../../../base/common/uri.js";
export declare const IAgentHostNewSessionFolderService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostNewSessionFolderService>;
/**
* Per-window store of the working directory a user picked for a not-yet-started
* agent-host session, keyed by the chat session resource it was picked against
* (including the untitled compose resource). An agent-host session's working
* directory is an argument to session creation and is immutable afterwards, so
* in a multi-root window the Folder picker chip records the choice here and the
* working-directory resolution sites consult it before falling back to the
* first workspace folder. Keying by the compose resource lets the choice
* survive the untitled-to-real rebind that happens when the session is created.
*/
export interface IAgentHostNewSessionFolderService {
    readonly _serviceBrand: undefined;
    /**
    * Fires with the session resource whose chosen folder changed.
    */
    readonly onDidChangeFolder: Event<URI>;
    /**
    * The folder chosen for the given session resource, or `undefined` if the
    * user has not made an explicit choice.
    */
    getFolder(sessionResource: URI): URI | undefined;
    /**
    * Record the folder chosen for the given session resource. Fires
    * {@link onDidChangeFolder} when the value actually changes.
    */
    setFolder(sessionResource: URI, folder: URI): void;
    /**
    * Forget any choice recorded for the given session resource.
    */
    clear(sessionResource: URI): void;
    /**
    * The most recently chosen folder in this window (across all sessions),
    * provided it is still a current workspace folder, or `undefined` if the
    * user has never made an explicit choice (or it is no longer in the
    * workspace). Unlike {@link getFolder} this is a window-level "sticky"
    * default that survives session disposal, so a new chat defaults to the
    * folder the user last picked instead of resetting to the first folder.
    */
    getDefaultFolder(): URI | undefined;
}
