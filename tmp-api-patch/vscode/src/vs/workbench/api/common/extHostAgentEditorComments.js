
import { Emitter } from '../../../base/common/event.js';
import { MainContext } from './extHost.protocol.js';
import { Range } from './extHostTypeConverters.js';

class ExtHostAgentEditorCommentsProvider {
    get comments() {
        return this._comments;
    }
    constructor(handle, proxy, onDispose) {
        this.handle = handle;
        this.proxy = proxy;
        this.onDispose = onDispose;
        this._onDidChange = ( new Emitter());
        this.onDidChange = this._onDidChange.event;
        this._comments = [];
    }
    $acceptComments(comments) {
        this._comments = ( comments.map(comment => ( Object.freeze({
            id: comment.id,
            range: Range.to(comment.range),
            body: comment.body,
            author: comment.author
        }))));
        this._onDidChange.fire();
    }
    addComment(range, body) {
        this.proxy.$addComment(this.handle, Range.from(range), body);
    }
    dispose() {
        this.proxy.$disposeAgentEditorComments(this.handle);
        this._onDidChange.dispose();
        this.onDispose(this.handle);
    }
}
class ExtHostAgentEditorComments {
    static {
        this.handlePool = 0;
    }
    constructor(mainContext) {
        this.providers = ( new Map());
        this.proxy = ( mainContext.getProxy(MainContext.MainThreadAgentEditorComments));
    }
    createAgentEditorComments(uri) {
        const handle = ExtHostAgentEditorComments.handlePool++;
        const provider = ( new ExtHostAgentEditorCommentsProvider(handle, this.proxy, h => this.providers.delete(h)));
        this.providers.set(handle, provider);
        this.proxy.$createAgentEditorComments(handle, uri);
        return provider;
    }
    $acceptAgentEditorComments(handle, comments) {
        this.providers.get(handle)?.$acceptComments(comments);
    }
}

export { ExtHostAgentEditorComments };
