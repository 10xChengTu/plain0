
import { localize } from '../../../../nls.js';
import { registerColor, transparent } from '../colorUtils.js';
import { contrastBorder, activeContrastBorder, foreground } from './baseColors.js';
import { selectForeground, selectBackground } from './inputColors.js';
import { listActiveSelectionForeground, listActiveSelectionBackground } from './listColors.js';

const menuBorder = registerColor("menu.border", {
    dark: null,
    light: null,
    hcDark: contrastBorder,
    hcLight: contrastBorder
}, ( localize(2512, "Border color of menus.")));
const menuForeground = registerColor("menu.foreground", selectForeground, ( localize(2513, "Foreground color of menu items.")));
const menuBackground = registerColor("menu.background", selectBackground, ( localize(2514, "Background color of menu items.")));
registerColor("menu.selectionForeground", listActiveSelectionForeground, ( localize(2515, "Foreground color of the selected menu item in menus.")));
registerColor("menu.selectionBackground", listActiveSelectionBackground, ( localize(2516, "Background color of the selected menu item in menus.")));
const menuSelectionBorder = registerColor("menu.selectionBorder", {
    dark: null,
    light: null,
    hcDark: activeContrastBorder,
    hcLight: activeContrastBorder
}, ( localize(2517, "Border color of the selected menu item in menus.")));
const menuSeparatorBackground = registerColor("menu.separatorBackground", {
    dark: ( transparent(foreground, 0.2)),
    light: ( transparent(foreground, 0.2)),
    hcDark: contrastBorder,
    hcLight: contrastBorder
}, ( localize(2518, "Color of a separator menu item in menus.")));

export { menuBackground, menuBorder, menuForeground, menuSelectionBorder, menuSeparatorBackground };
