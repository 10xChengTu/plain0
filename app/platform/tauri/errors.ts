import type { CommandError } from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function normalizeCommandError(error: unknown): CommandError {
	if (
		isRecord(error) &&
		typeof error.code === "string" &&
		typeof error.message === "string"
	) {
		return {
			code: error.code,
			message: error.message,
			...(error.details === undefined ? {} : { details: error.details }),
		};
	}

	if (error instanceof Error) {
		return {
			code: "IPC_FAILED",
			message: error.message,
		};
	}

	return {
		code: "IPC_FAILED",
		message: typeof error === "string" ? error : "Unknown IPC failure",
	};
}
