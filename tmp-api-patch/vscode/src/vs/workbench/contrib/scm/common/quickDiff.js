
import { localize } from '../../../../nls.js';
import { Color } from '../../../../base/common/color.js';
import { registerColor, lighten, darken, transparent, opaque } from '../../../../platform/theme/common/colorUtils.js';
import '../../../../platform/theme/common/colors/baseColors.js';
import '../../../../platform/theme/common/colors/chartsColors.js';
import { editorErrorForeground, editorForeground, editorBackground } from '../../../../platform/theme/common/colors/editorColors.js';
import '../../../../platform/theme/common/colors/inputColors.js';
import { listInactiveSelectionBackground } from '../../../../platform/theme/common/colors/listColors.js';
import '../../../../platform/theme/common/colors/menuColors.js';
import '../../../../platform/theme/common/colors/minimapColors.js';
import '../../../../platform/theme/common/colors/miscColors.js';
import '../../../../platform/theme/common/colors/quickpickColors.js';
import '../../../../platform/theme/common/colors/searchColors.js';

const editorGutterModifiedBackground = registerColor("editorGutter.modifiedBackground", {
    dark: "#1B81A8",
    light: "#2090D3",
    hcDark: "#1B81A8",
    hcLight: "#2090D3"
}, ( localize(13820, "Editor gutter background color for lines that are modified.")));
registerColor("editorGutter.modifiedSecondaryBackground", {
    dark: ( darken(editorGutterModifiedBackground, 0.5)),
    light: ( lighten(editorGutterModifiedBackground, 0.7)),
    hcDark: "#1B81A8",
    hcLight: "#2090D3"
}, ( localize(
    13821,
    "Editor gutter secondary background color for lines that are modified."
)));
const editorGutterAddedBackground = registerColor("editorGutter.addedBackground", {
    dark: "#487E02",
    light: "#48985D",
    hcDark: "#487E02",
    hcLight: "#48985D"
}, ( localize(13822, "Editor gutter background color for lines that are added.")));
registerColor("editorGutter.addedSecondaryBackground", {
    dark: ( darken(editorGutterAddedBackground, 0.5)),
    light: ( lighten(editorGutterAddedBackground, 0.7)),
    hcDark: "#487E02",
    hcLight: "#48985D"
}, ( localize(
    13823,
    "Editor gutter secondary background color for lines that are added."
)));
const editorGutterDeletedBackground = registerColor("editorGutter.deletedBackground", editorErrorForeground, ( localize(13824, "Editor gutter background color for lines that are deleted.")));
registerColor("editorGutter.deletedSecondaryBackground", {
    dark: ( darken(editorGutterDeletedBackground, 0.4)),
    light: ( lighten(editorGutterDeletedBackground, 0.3)),
    hcDark: "#F48771",
    hcLight: "#B5200D"
}, ( localize(
    13825,
    "Editor gutter secondary background color for lines that are deleted."
)));
const minimapGutterModifiedBackground = registerColor(
    "minimapGutter.modifiedBackground",
    editorGutterModifiedBackground,
    ( localize(13826, "Minimap gutter background color for lines that are modified."))
);
const minimapGutterAddedBackground = registerColor(
    "minimapGutter.addedBackground",
    editorGutterAddedBackground,
    ( localize(13827, "Minimap gutter background color for lines that are added."))
);
const minimapGutterDeletedBackground = registerColor(
    "minimapGutter.deletedBackground",
    editorGutterDeletedBackground,
    ( localize(13828, "Minimap gutter background color for lines that are deleted."))
);
const overviewRulerModifiedForeground = registerColor("editorOverviewRuler.modifiedForeground", ( transparent(editorGutterModifiedBackground, 0.6)), ( localize(13829, "Overview ruler marker color for modified content.")));
const overviewRulerAddedForeground = registerColor("editorOverviewRuler.addedForeground", ( transparent(editorGutterAddedBackground, 0.6)), ( localize(13830, "Overview ruler marker color for added content.")));
const overviewRulerDeletedForeground = registerColor("editorOverviewRuler.deletedForeground", ( transparent(editorGutterDeletedBackground, 0.6)), ( localize(13831, "Overview ruler marker color for deleted content.")));
registerColor("editorGutter.itemGlyphForeground", {
    dark: editorForeground,
    light: editorForeground,
    hcDark: Color.black,
    hcLight: Color.white
}, ( localize(13832, "Editor gutter decoration color for gutter item glyphs.")));
registerColor("editorGutter.itemBackground", {
    dark: opaque(listInactiveSelectionBackground, editorBackground),
    light: ( darken(opaque(listInactiveSelectionBackground, editorBackground), .05)),
    hcDark: Color.white,
    hcLight: Color.black
}, ( localize(
    13833,
    "Editor gutter decoration color for gutter item background. This color should be opaque."
)));
var ChangeType;
(function(ChangeType) {
    ChangeType[ChangeType["Modify"] = 0] = "Modify";
    ChangeType[ChangeType["Add"] = 1] = "Add";
    ChangeType[ChangeType["Delete"] = 2] = "Delete";
})(ChangeType || (ChangeType = {}));
function compareChanges(a, b) {
    let result = a.modifiedStartLineNumber - b.modifiedStartLineNumber;
    if (result !== 0) {
        return result;
    }
    result = a.modifiedEndLineNumber - b.modifiedEndLineNumber;
    if (result !== 0) {
        return result;
    }
    result = a.originalStartLineNumber - b.originalStartLineNumber;
    if (result !== 0) {
        return result;
    }
    return a.originalEndLineNumber - b.originalEndLineNumber;
}
function getModifiedEndLineNumber(change) {
    if (change.modifiedEndLineNumber === 0) {
        return change.modifiedStartLineNumber === 0 ? 1 : change.modifiedStartLineNumber;
    } else {
        return change.modifiedEndLineNumber;
    }
}

export { ChangeType, compareChanges, getModifiedEndLineNumber, minimapGutterAddedBackground, minimapGutterDeletedBackground, minimapGutterModifiedBackground, overviewRulerAddedForeground, overviewRulerDeletedForeground, overviewRulerModifiedForeground };
