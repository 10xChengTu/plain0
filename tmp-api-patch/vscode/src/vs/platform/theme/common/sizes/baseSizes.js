
import { localize } from '../../../../nls.js';
import { registerSize, sizeForAllThemes } from '../sizeUtils.js';

registerSize("bodyFontSize", sizeForAllThemes(13, "px"), ( localize(
    2565,
    "Base font size. This size is used if not overridden by a component."
)));
registerSize("bodyFontSize.small", sizeForAllThemes(12, "px"), ( localize(2566, "Small font size for secondary content.")));
registerSize("bodyFontSize.xSmall", sizeForAllThemes(11, "px"), ( localize(2567, "Extra small font size for less prominent content.")));
registerSize("codiconFontSize", sizeForAllThemes(16, "px"), ( localize(2568, "Base font size for codicons.")));
registerSize("codiconFontSize.compact", sizeForAllThemes(12, "px"), ( localize(2569, "Compact font size for codicons.")));
registerSize("cornerRadius.medium", sizeForAllThemes(6, "px"), ( localize(2570, "Base corner radius for UI elements.")));
registerSize("cornerRadius.xSmall", sizeForAllThemes(2, "px"), ( localize(2571, "Extra small corner radius for very compact UI elements.")));
registerSize("cornerRadius.small", sizeForAllThemes(4, "px"), ( localize(2572, "Small corner radius for compact UI elements.")));
registerSize("cornerRadius.large", sizeForAllThemes(8, "px"), ( localize(2573, "Large corner radius for prominent UI elements.")));
registerSize("cornerRadius.xLarge", sizeForAllThemes(12, "px"), ( localize(2574, "Extra large corner radius for very prominent UI elements.")));
registerSize("cornerRadius.circle", sizeForAllThemes(9999, "px"), ( localize(2575, "Circular corner radius for fully rounded UI elements.")));
registerSize("strokeThickness", sizeForAllThemes(1, "px"), ( localize(2576, "Base stroke thickness for borders and outlines.")));
registerSize("spacing.sizeNone", sizeForAllThemes(0, "px"), ( localize(2577, "No spacing (0px).")));
registerSize("spacing.size20", sizeForAllThemes(2, "px"), ( localize(2578, "Spacing of 2px.")));
registerSize("spacing.size40", sizeForAllThemes(4, "px"), ( localize(2579, "Spacing of 4px.")));
registerSize("spacing.size60", sizeForAllThemes(6, "px"), ( localize(2580, "Spacing of 6px.")));
registerSize("spacing.size80", sizeForAllThemes(8, "px"), ( localize(2581, "Spacing of 8px.")));
registerSize("spacing.size100", sizeForAllThemes(10, "px"), ( localize(2582, "Spacing of 10px.")));
registerSize("spacing.size120", sizeForAllThemes(12, "px"), ( localize(2583, "Spacing of 12px.")));
registerSize("spacing.size160", sizeForAllThemes(16, "px"), ( localize(2584, "Spacing of 16px.")));
registerSize("spacing.size200", sizeForAllThemes(20, "px"), ( localize(2585, "Spacing of 20px.")));
registerSize("spacing.size240", sizeForAllThemes(24, "px"), ( localize(2586, "Spacing of 24px.")));
registerSize("spacing.size280", sizeForAllThemes(28, "px"), ( localize(2587, "Spacing of 28px.")));
registerSize("spacing.size320", sizeForAllThemes(32, "px"), ( localize(2588, "Spacing of 32px.")));
registerSize("spacing.size360", sizeForAllThemes(36, "px"), ( localize(2589, "Spacing of 36px.")));
registerSize("spacing.size400", sizeForAllThemes(40, "px"), ( localize(2590, "Spacing of 40px.")));
