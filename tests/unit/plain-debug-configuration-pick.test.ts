import { describe, expect, it, vi } from "vitest";

import type { LaunchConfiguration } from "../../app/features/debug/plain-debug-adapter-config";
import { selectPlainLaunchConfiguration } from "../../app/features/debug/plain-debug-configuration-pick";

function configuration(name: string, type: string): LaunchConfiguration {
	return {
		type,
		request: "launch",
		name,
		hasUnsupportedTaskIntegration: false,
		launchArguments: {},
	};
}

const CONFIG_A = configuration("Debug main.py", "python");
const CONFIG_B = configuration("Attach to server", "node");

describe("selectPlainLaunchConfiguration", () => {
	it("returns no configuration for an empty launch.json without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(
			selectPlainLaunchConfiguration([], pick),
		).resolves.toBeUndefined();
		expect(pick).not.toHaveBeenCalled();
	});

	it("automatically selects a sole configuration without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(
			selectPlainLaunchConfiguration([CONFIG_A], pick),
		).resolves.toEqual(CONFIG_A);
		expect(pick).not.toHaveBeenCalled();
	});

	it("requires an explicit multi-configuration choice and preserves cancellation", async () => {
		const configurations = [CONFIG_A, CONFIG_B];
		const pickSecond = vi.fn(async (items) => items[1]);
		await expect(
			selectPlainLaunchConfiguration(configurations, pickSecond),
		).resolves.toEqual(CONFIG_B);
		expect(pickSecond.mock.calls[0]?.[0]).toEqual([
			{
				label: "Debug main.py",
				description: "python",
				configuration: CONFIG_A,
			},
			{
				label: "Attach to server",
				description: "node",
				configuration: CONFIG_B,
			},
		]);
		await expect(
			selectPlainLaunchConfiguration(configurations, async () => undefined),
		).resolves.toBeUndefined();
	});
});
