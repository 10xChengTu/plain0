
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.service.js';
import { IFileService } from '../../../../platform/files/common/files.service.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.service.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.service.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from '../../files/browser/fileConstants.js';

let WorkbenchOpenerContribution = class WorkbenchOpenerContribution extends Disposable {
    static {
        this.ID = "workbench.contrib.opener";
    }
    constructor(openerService, commandService, fileService, workspaceContextService) {
        super();
        this.commandService = commandService;
        this.fileService = fileService;
        this.workspaceContextService = workspaceContextService;
        this._register(openerService.registerOpener(this));
    }
    async open(link, options) {
        try {
            if (options?.openExternal) {
                return false;
            }
            const uri = typeof link === "string" ? ( URI.parse(link)) : link;
            if (this.workspaceContextService.isInsideWorkspace(uri)) {
                if ((await this.fileService.stat(uri)).isDirectory) {
                    await this.commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, uri);
                    return true;
                }
            }
        } catch {}
        return false;
    }
};
WorkbenchOpenerContribution = ( __decorate([( __param(0, IOpenerService)), ( __param(1, ICommandService)), ( __param(2, IFileService)), ( __param(3, IWorkspaceContextService))], WorkbenchOpenerContribution));
registerWorkbenchContribution2(
    WorkbenchOpenerContribution.ID,
    WorkbenchOpenerContribution,
    WorkbenchPhase.Eventually
);
