interface WorkerDefinition {
	url: string;
	options: WorkerOptions;
}

interface MonacoEnvironmentConfig {
	getWorkerUrl(moduleId: string, label: string): string;
	getWorkerOptions(moduleId: string, label: string): WorkerOptions | undefined;
}

const workers: Record<string, WorkerDefinition> = {
	editorWorkerService: {
		url: new URL(
			"monaco-editor/esm/vs/editor/editor.worker.js",
			import.meta.url,
		).toString(),
		options: { type: "module", name: "plain-editor-worker" },
	},
	TextMateWorker: {
		url: new URL(
			"@codingame/monaco-vscode-textmate-service-override/worker",
			import.meta.url,
		).toString(),
		options: { type: "module", name: "plain-textmate-worker" },
	},
};

export function configureMonacoEnvironment(): void {
	const environment: MonacoEnvironmentConfig = {
		getWorkerUrl(_moduleId, label) {
			const definition = workers[label];
			if (definition === undefined) {
				throw new Error(`Plain 拒绝启动未授权的 Monaco worker：${label}`);
			}
			return definition.url;
		},
		getWorkerOptions(_moduleId, label) {
			return workers[label]?.options;
		},
	};

	Object.assign(globalThis, { MonacoEnvironment: environment });
}
