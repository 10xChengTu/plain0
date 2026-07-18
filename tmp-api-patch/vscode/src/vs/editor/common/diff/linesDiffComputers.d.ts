import { LegacyLinesDiffComputer } from "./legacyLinesDiffComputer.js";
import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.js";
import { ILinesDiffComputer } from "./linesDiffComputer.js";
export declare const linesDiffComputers: {
    getLegacy: () => LegacyLinesDiffComputer;
    getDefault: () => DefaultLinesDiffComputer;
    getAdvancedExternal: () => Promise<ILinesDiffComputer>;
    getAdvancedWasm: () => Promise<ILinesDiffComputer>;
};
