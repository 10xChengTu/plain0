
import { localize } from '../../../../nls.js';
import { registerColor, transparent } from '../colorUtils.js';
import { foreground } from './baseColors.js';
import { editorErrorForeground, editorInfoForeground, editorWarningForeground } from './editorColors.js';
import { minimapFindMatch } from './minimapColors.js';

const chartsForeground = registerColor("charts.foreground", foreground, ( localize(2326, "The foreground color used in charts.")));
const chartsLines = registerColor("charts.lines", ( transparent(foreground, .5)), ( localize(2327, "The color used for horizontal lines in charts.")));
const chartsRed = registerColor("charts.red", editorErrorForeground, ( localize(2328, "The red color used in chart visualizations.")));
const chartsBlue = registerColor("charts.blue", editorInfoForeground, ( localize(2329, "The blue color used in chart visualizations.")));
const chartsYellow = registerColor("charts.yellow", editorWarningForeground, ( localize(2330, "The yellow color used in chart visualizations.")));
registerColor("charts.orange", minimapFindMatch, ( localize(2331, "The orange color used in chart visualizations.")));
const chartsGreen = registerColor("charts.green", {
    dark: "#89D185",
    light: "#388A34",
    hcDark: "#89D185",
    hcLight: "#374e06"
}, ( localize(2332, "The green color used in chart visualizations.")));
const chartsPurple = registerColor("charts.purple", {
    dark: "#B180D7",
    light: "#652D90",
    hcDark: "#B180D7",
    hcLight: "#652D90"
}, ( localize(2333, "The purple color used in chart visualizations.")));

export { chartsBlue, chartsForeground, chartsGreen, chartsLines, chartsPurple, chartsRed, chartsYellow };
