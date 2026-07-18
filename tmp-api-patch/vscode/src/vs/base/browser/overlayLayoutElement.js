
import { createElement, setParentFlowTo, getComputedStyle } from './dom.js';
import { generateUuid } from '../common/uuid.js';

function getOrCreateAnchorName(element) {
    const existing = element.style.getPropertyValue('anchor-name');
    if (existing) {
        return existing;
    }
    const name = `--overlay-anchor-${generateUuid()}`;
    element.style.setProperty('anchor-name', name);
    return name;
}
class OverlayLayoutElement {
    constructor() {
        this.content = createElement('div');
        this.content.style.position = 'absolute';
        this.content.style.overflow = 'hidden';
        this._root = createElement('div');
        this._root.appendChild(this.content);
        this.reapplyLayoutStyles();
    }
    reapplyLayoutStyles() {
        this.content.style.position = 'fixed';
        this.content.style.top = 'anchor(top)';
        this.content.style.left = 'anchor(left)';
        this.content.style.width = 'anchor-size(width)';
        this.content.style.height = 'anchor-size(height)';
        this.content.style.pointerEvents = 'auto';
        this._root.style.position = 'absolute';
        this._root.style.pointerEvents = 'none';
    }
    dispose() {
        this.root.remove();
    }
    get root() {
        return this._root;
    }
    setAnchorElement(anchorElement, options) {
        if (this._currentAnchor?.element !== anchorElement) {
            const name = getOrCreateAnchorName(anchorElement);
            this.content.style.setProperty('position-anchor', name);
            setParentFlowTo(this.content, anchorElement);
            this._currentAnchor = { element: anchorElement, name };
        }
        this._updateClipping(options?.clippingContainer);
        this._updateZIndex(anchorElement);
    }
    _updateZIndex(anchorElement) {
        let zIndex = '';
        for (let el = anchorElement; el; el = el.parentElement) {
            const computed = getComputedStyle(el).zIndex;
            if (computed && computed !== 'auto') {
                zIndex = String(Number(computed) + 1);
                break;
            }
        }
        this.content.style.zIndex = zIndex;
    }
    _updateClipping(clippingContainer) {
        if (this._clippingAnchor?.element === clippingContainer) {
            return;
        }
        this._root.style.removeProperty('position-anchor');
        const ws = this._root.style;
        if (clippingContainer) {
            const name = getOrCreateAnchorName(clippingContainer);
            ws.clipPath = 'content-box';
            ws.setProperty('position-anchor', name);
            ws.setProperty('top', 'anchor(top)');
            ws.setProperty('left', 'anchor(left)');
            ws.setProperty('width', `anchor-size(width)`);
            ws.setProperty('height', `anchor-size(height)`);
            this._clippingAnchor = { element: clippingContainer, name };
        }
        else {
            ws.clipPath = '';
            ws.setProperty('top', '0');
            ws.setProperty('left', '0');
            ws.setProperty('right', '0');
            ws.setProperty('bottom', '0');
            this._clippingAnchor = undefined;
        }
    }
}

export { OverlayLayoutElement };
