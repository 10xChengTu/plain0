const CONTRACT_MESSAGE =
	"Native IPC returned a payload that violates the Plain window contract.";

class WindowIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_MESSAGE);
		this.name = "WindowIpcContractViolation";
	}
}

export function decodeWindowVoid(value: unknown): void {
	if (value !== null) {
		throw new WindowIpcContractViolation();
	}
}
