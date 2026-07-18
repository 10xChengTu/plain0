
import { registerCss } from '../../../../../../../css.js';
import * as symbolIcons from './symbolIcons.css';
import { localize } from '../../../../nls.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { foreground } from '../../../../platform/theme/common/colors/baseColors.js';
import '../../../../platform/theme/common/colors/chartsColors.js';
import '../../../../platform/theme/common/colors/editorColors.js';
import '../../../../platform/theme/common/colors/inputColors.js';
import '../../../../platform/theme/common/colors/listColors.js';
import '../../../../platform/theme/common/colors/menuColors.js';
import '../../../../platform/theme/common/colors/minimapColors.js';
import '../../../../platform/theme/common/colors/miscColors.js';
import '../../../../platform/theme/common/colors/quickpickColors.js';
import '../../../../platform/theme/common/colors/searchColors.js';

registerCss(symbolIcons);
registerColor("symbolIcon.arrayForeground", foreground, ( localize(
    1642,
    "The foreground color for array symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.booleanForeground", foreground, ( localize(
    1643,
    "The foreground color for boolean symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.classForeground", {
    dark: "#EE9D28",
    light: "#D67E00",
    hcDark: "#EE9D28",
    hcLight: "#D67E00"
}, ( localize(
    1644,
    "The foreground color for class symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.colorForeground", foreground, ( localize(
    1645,
    "The foreground color for color symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.constantForeground", foreground, ( localize(
    1646,
    "The foreground color for constant symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.constructorForeground", {
    dark: "#B180D7",
    light: "#652D90",
    hcDark: "#B180D7",
    hcLight: "#652D90"
}, ( localize(
    1647,
    "The foreground color for constructor symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_ENUMERATOR_FOREGROUND = registerColor("symbolIcon.enumeratorForeground", {
    dark: "#EE9D28",
    light: "#D67E00",
    hcDark: "#EE9D28",
    hcLight: "#D67E00"
}, ( localize(
    1648,
    "The foreground color for enumerator symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_ENUMERATOR_MEMBER_FOREGROUND = registerColor("symbolIcon.enumeratorMemberForeground", {
    dark: "#75BEFF",
    light: "#007ACC",
    hcDark: "#75BEFF",
    hcLight: "#007ACC"
}, ( localize(
    1649,
    "The foreground color for enumerator member symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.eventForeground", {
    dark: "#EE9D28",
    light: "#D67E00",
    hcDark: "#EE9D28",
    hcLight: "#D67E00"
}, ( localize(
    1650,
    "The foreground color for event symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.fieldForeground", {
    dark: "#75BEFF",
    light: "#007ACC",
    hcDark: "#75BEFF",
    hcLight: "#007ACC"
}, ( localize(
    1651,
    "The foreground color for field symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_FILE_FOREGROUND = registerColor("symbolIcon.fileForeground", foreground, ( localize(
    1652,
    "The foreground color for file symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_FOLDER_FOREGROUND = registerColor("symbolIcon.folderForeground", foreground, ( localize(
    1653,
    "The foreground color for folder symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.functionForeground", {
    dark: "#B180D7",
    light: "#652D90",
    hcDark: "#B180D7",
    hcLight: "#652D90"
}, ( localize(
    1654,
    "The foreground color for function symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.interfaceForeground", {
    dark: "#75BEFF",
    light: "#007ACC",
    hcDark: "#75BEFF",
    hcLight: "#007ACC"
}, ( localize(
    1655,
    "The foreground color for interface symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.keyForeground", foreground, ( localize(
    1656,
    "The foreground color for key symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.keywordForeground", foreground, ( localize(
    1657,
    "The foreground color for keyword symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_METHOD_FOREGROUND = registerColor("symbolIcon.methodForeground", {
    dark: "#B180D7",
    light: "#652D90",
    hcDark: "#B180D7",
    hcLight: "#652D90"
}, ( localize(
    1658,
    "The foreground color for method symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.moduleForeground", foreground, ( localize(
    1659,
    "The foreground color for module symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.namespaceForeground", foreground, ( localize(
    1660,
    "The foreground color for namespace symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.nullForeground", foreground, ( localize(
    1661,
    "The foreground color for null symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.numberForeground", foreground, ( localize(
    1662,
    "The foreground color for number symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.objectForeground", foreground, ( localize(
    1663,
    "The foreground color for object symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.operatorForeground", foreground, ( localize(
    1664,
    "The foreground color for operator symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.packageForeground", foreground, ( localize(
    1665,
    "The foreground color for package symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.propertyForeground", foreground, ( localize(
    1666,
    "The foreground color for property symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.referenceForeground", foreground, ( localize(
    1667,
    "The foreground color for reference symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.snippetForeground", foreground, ( localize(
    1668,
    "The foreground color for snippet symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.stringForeground", foreground, ( localize(
    1669,
    "The foreground color for string symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.structForeground", foreground, ( localize(
    1670,
    "The foreground color for struct symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.textForeground", foreground, ( localize(
    1671,
    "The foreground color for text symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.typeParameterForeground", foreground, ( localize(
    1672,
    "The foreground color for type parameter symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
registerColor("symbolIcon.unitForeground", foreground, ( localize(
    1673,
    "The foreground color for unit symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));
const SYMBOL_ICON_VARIABLE_FOREGROUND = registerColor("symbolIcon.variableForeground", {
    dark: "#75BEFF",
    light: "#007ACC",
    hcDark: "#75BEFF",
    hcLight: "#007ACC"
}, ( localize(
    1674,
    "The foreground color for variable symbols. These symbols appear in the outline, breadcrumb, and suggest widget."
)));

export { SYMBOL_ICON_ENUMERATOR_FOREGROUND, SYMBOL_ICON_ENUMERATOR_MEMBER_FOREGROUND, SYMBOL_ICON_FILE_FOREGROUND, SYMBOL_ICON_FOLDER_FOREGROUND, SYMBOL_ICON_METHOD_FOREGROUND, SYMBOL_ICON_VARIABLE_FOREGROUND };
