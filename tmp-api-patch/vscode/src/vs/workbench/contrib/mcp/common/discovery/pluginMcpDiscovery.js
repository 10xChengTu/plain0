
import { __decorate, __param } from '../../../../../../../../external/tslib/tslib.es6.js';
import { hash } from '../../../../../base/common/hash.js';
import { Disposable, DisposableResourceMap } from '../../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import '../../../../../base/common/observableInternal/index.js';
import { isDefined } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { McpServerType } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IAgentPluginService } from '../../../chat/common/plugins/agentPluginService.service.js';
import { isContributionEnabled } from '../../../chat/common/enablement.js';
import { IMcpRegistry } from '../mcpRegistryTypes.service.js';
import { McpCollectionSortOrder, McpServerTrust, McpServerTransportType } from '../mcpTypes.js';
import { autorun } from '../../../../../base/common/observableInternal/reactions/autorun.js';

const MCP_PLUGIN_COLLECTION_ID_PREFIX = "plugin.";
let PluginMcpDiscovery = class PluginMcpDiscovery extends Disposable {
    constructor(_agentPluginService, _mcpRegistry) {
        super();
        this._agentPluginService = _agentPluginService;
        this._mcpRegistry = _mcpRegistry;
        this.fromGallery = false;
        this._collections = this._register(( new DisposableResourceMap()));
    }
    start() {
        this._register(autorun(reader => {
            const plugins = this._agentPluginService.plugins.read(reader);
            const seen = ( new ResourceSet());
            for (const plugin of plugins) {
                if (!isContributionEnabled(plugin.enablement.read(reader))) {
                    continue;
                }
                const servers = plugin.mcpServerDefinitions.read(reader);
                if (servers.length === 0) {
                    continue;
                }
                seen.add(plugin.uri);
                let collectionState = this._collections.get(plugin.uri);
                if (!collectionState) {
                    collectionState = this.createCollectionState(plugin, servers[0].uri);
                    this._collections.set(plugin.uri, collectionState);
                }
            }
            for (const [pluginUri] of this._collections) {
                if (!( seen.has(pluginUri))) {
                    this._collections.deleteAndDispose(pluginUri);
                }
            }
        }));
    }
    createCollectionState(plugin, manifestURI) {
        const collectionId = `${MCP_PLUGIN_COLLECTION_ID_PREFIX}${plugin.uri}`;
        return this._mcpRegistry.registerCollection({
            id: collectionId,
            label: `${plugin.label} (Agent Plugin)`,
            remoteAuthority: plugin.uri.scheme === Schemas.vscodeRemote ? plugin.uri.authority : null,
            configTarget: ConfigurationTarget.USER,
            scope: StorageScope.PROFILE,
            trustBehavior: McpServerTrust.Kind.Trusted,
            serverDefinitions: ( plugin.mcpServerDefinitions.map(defs => ( defs.map(d => this._toServerDefinition(collectionId, d))).filter(isDefined))),
            order: McpCollectionSortOrder.Plugin,
            presentation: {
                origin: manifestURI
            }
        });
    }
    _toServerDefinition(
        collectionId,
        {
            name,
            configuration
        }
    ) {
        const launch = this._toLaunch(configuration);
        if (!launch) {
            return undefined;
        }
        return {
            id: `${collectionId}.${name}`,
            label: name,
            launch,
            variableReplacement: {
                target: ConfigurationTarget.USER
            },
            cacheNonce: String(hash(launch))
        };
    }
    _toLaunch(config) {
        if (config.type === McpServerType.LOCAL) {
            return {
                type: McpServerTransportType.Stdio,
                command: config.command,
                args: config.args ? [...config.args] : [],
                env: config.env ? {
                    ...config.env
                } : {},
                envFile: config.envFile,
                cwd: config.cwd,
                sandbox: undefined
            };
        }
        try {
            return {
                type: McpServerTransportType.HTTP,
                uri: ( URI.parse(config.url)),
                headers: Object.entries(config.headers ?? {}),
                oauth: config.oauth
            };
        } catch {
            return undefined;
        }
    }
};
PluginMcpDiscovery = ( __decorate([( __param(0, IAgentPluginService)), ( __param(1, IMcpRegistry))], PluginMcpDiscovery));

export { MCP_PLUGIN_COLLECTION_ID_PREFIX, PluginMcpDiscovery };
