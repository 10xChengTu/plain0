import { IDisposable } from "../common/lifecycle.js";
/**
 * Positions an element over another element anywhere in the dom using absolute positioning.
 *
 * This is useful for cases where a dom node cannot be re-parented without losing its state, such as a iframe.
 *
 * Call {@link setAnchorElement} each time the layout is recalculated. When the
 * same anchor element is passed again the call is a no-op (the browser keeps them in sync).
 */
export declare class OverlayLayoutElement implements IDisposable {
    private _currentAnchor?;
    private _clippingAnchor?;
    /**
     * The root element that contains the overlay element.
     *
     * This also provides clipping support for the overlay element. Clipping is needed when the anchor is
     * scrollable and may scroll and be hidden by overflow from its parent container.
     */
    private readonly _root;
    constructor();
    reapplyLayoutStyles(): void;
    dispose(): void;
    /**
     * The outermost element. This is what should be appended to the actual dom hierarchy, typically near to
     * the document root node.
     */
    get root(): HTMLElement;
    /**
     * The actual element that is positioned over the anchor.
     */
    readonly content: HTMLElement;
    /**
     * Position the content over `anchorElement`.
     *
     * This only needs to be called when the anchor element or the clipping container changes.
     */
    setAnchorElement(anchorElement: HTMLElement, options?: {
        readonly clippingContainer?: HTMLElement;
    }): void;
    /**
     * Walk up from the anchor element to find the nearest ancestor with an explicit
     * z-index and place the overlay one level above it. This ensures the overlay sits
     * above modal layers or other stacking contexts.
     */
    private _updateZIndex;
    private _updateClipping;
}
