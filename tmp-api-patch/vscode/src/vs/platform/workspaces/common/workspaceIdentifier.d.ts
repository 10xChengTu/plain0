import { URI } from "../../../base/common/uri.js";
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from "../../workspace/common/workspace.js";
export declare function getWorkspaceIdentifier(workspaceUri: URI, id?: string): IWorkspaceIdentifier;
export declare function getSingleFolderWorkspaceIdentifier(folderUri: URI, id?: string): ISingleFolderWorkspaceIdentifier;
