/**
 * `F110` S4 (`docs/research/2026-07-28-legacy-retirement.md`, "主导会话裁定"
 * point 2): the Activity Bar's bottom "Manage" gear button, migrated from
 * `@codingame/monaco-vscode-api`'s
 * `vscode/src/vs/workbench/browser/parts/globalCompositeBar.js` into `app/`,
 * which `patches/@codingame__monaco-vscode-api@35.0.1.patch` now repoints
 * `activitybarPart.js`'s import at (its sole consumer — confirmed by
 * grepping the whole installed vendor tree for `globalCompositeBar`).
 *
 * `globalCompositeBar.js` is real, reachable Workbench code — never a
 * `missing-services.js` stub — but `check-bundle.mjs`'s `authAccount`
 * classifier matches it by filename, not content (`docs/bundle-baseline.json`
 * `categoryNotes`). The file also carries real account-UI classes
 * (`AccountsActivityActionViewItem`, `SimpleAccountActivityActionViewItem`,
 * `SimpleGlobalActivityActionViewItem`, `isAccountsActionVisible`/
 * `setAccountsActionVisible`) that an earlier patch already neutered into
 * no-ops: `registerListeners()`, `toggleAccountsActivity()`, the
 * `accountsVisibilityPreference` getter/setter, and
 * `setAccountsActionVisible()` were all replaced with no-ops/`false`/`[]`,
 * with `accountsVisibilityPreference` permanently `false`. Because of that,
 * `GlobalCompositeBar`'s own `accountAction` was *never* pushed onto its
 * `ActionBar` (guarded by `if (this.accountsVisibilityPreference)`), which
 * means the account branch of its `actionViewItemProvider` — and every class
 * that exists only to serve it — was already dead code. None of that is
 * ported here: only the things that are real and reachable are — the Manage
 * button itself (`GlobalActivityActionViewItem`, plus the
 * `AbstractGlobalActivityActionViewItem` base it needs for menu/keyboard/
 * mouse/touch handling), and its compact variant,
 * `SimpleGlobalActivityActionViewItem` (ported below as
 * `PlainSimpleGlobalActivityActionViewItem`).
 *
 * That compact variant's own port was a second, later correction: this
 * comment originally claimed grepping the whole installed vendor tree found
 * "no consumer of it at all, not even `activitybarPart.js` itself" — true for
 * `activitybarPart.js`, but the grep that produced that claim never reached a
 * *nested* `node_modules/.pnpm/` install path, and so missed
 * `@codingame/monaco-vscode-view-title-bar-service-override`'s
 * `titlebarPart.js` (a transitive dependency of
 * `@codingame/monaco-vscode-workbench-service-override`, which Plain does
 * depend on directly — not itself a direct `package.json` dependency), which
 * imports `SimpleGlobalActivityActionViewItem` and constructs it whenever its
 * own `actionViewItemProvider` is asked for `GLOBAL_ACTIVITY_ID` (i.e.
 * whenever the title bar's Activity Bar-adjacent toolbar renders the "Manage"
 * gear — the title bar variant of the same button this file already ports
 * for the Activity Bar itself). `docs/bundle-baseline.json`'s
 * `categoryNotes.authAccount` documents the full discovery story (F110 S2's
 * predicted floor of 5, why S4's `activitybarPart.js` repoint alone didn't
 * reach 0, and this second consumer that finally does). `titlebarPart.js`'s
 * own remaining vendor `globalCompositeBar.js` imports —
 * `SimpleAccountActivityActionViewItem`, `isAccountsActionVisible`,
 * `AccountsActivityActionViewItem` — are all dead for the same
 * `accountsVisibilityPreference`-always-false reason documented above, and
 * are handled directly in
 * `patches/@codingame__monaco-vscode-view-title-bar-service-override@35.0.1.patch`
 * (two branches deleted outright, one static-string constant inlined) rather
 * than ported here; only `SimpleGlobalActivityActionViewItem` — the one real,
 * reachable class — gets an `app/` counterpart.
 *
 * `PlainSimpleGlobalActivityActionViewItem` below subclasses
 * `PlainGlobalActivityActionViewItem` (not `PlainAbstractGlobalActivityActionViewItem`
 * directly), exactly mirroring the vendor's own
 * `SimpleGlobalActivityActionViewItem extends GlobalActivityActionViewItem`
 * relationship: its constructor supplies a fixed, always-the-same,
 * non-interactive context menu (`simpleGlobalActivityContextMenuActions`, a
 * single disabled "Manage" checkbox action — the vendor's own
 * `simpleActivityContextMenuActions` helper ignores both of its parameters
 * unconditionally, so nothing is lost by porting it as a parameterless
 * function) and a `compact: true` rendering option, then delegates everything
 * else to the base class unchanged. `environmentService` and `storageService`
 * are dropped from its ported constructor for the same reason
 * `PlainGlobalActivityActionViewItem` already drops its own `environmentService`
 * and `PlainGlobalCompositeBar` already drops `storageService`/
 * `extensionService`: reading the vendor class's whole body confirms neither
 * parameter is referenced for anything except forwarding into
 * `simpleActivityContextMenuActions`, which (per the point above) ignores
 * both of its own parameters too — so nothing downstream ever actually reads
 * either value.
 *
 * Dropping the account branch also drops every constructor parameter that
 * only served it: the original `GlobalCompositeBar` accepted `storageService`
 * (used only inside the dead `setAccountsActionVisible(storageService,
 * false)` closure) and `extensionService` (assigned to a field that was never
 * read anywhere in the class — confirmed by reading the whole original file)
 * — neither survives here. The original `GlobalActivityActionViewItem` also
 * accepted an `environmentService` that was never referenced anywhere in its
 * body either (a vestige, not something this migration removes behaviour
 * from) — also dropped. Losing `storageService`/`extensionService` here,
 * combined with dropping `AccountsActivityActionViewItem` (the only class in
 * the original file injected with `IAuthenticationService` as a non-optional
 * constructor parameter), is what finally lets `F110` S4 delete
 * `missing-services.js`'s `IAuthenticationService` import/class/
 * `registerSingleton` three-part registration that `F110` S2 had to keep
 * (see that slice's `docs/bundle-baseline.json` `categoryNotes.authAccount`
 * entry) purely for this file's sake — nothing left in the running product
 * still asks the DI container for that token.
 *
 * Only the two classes actually passed to `instantiationService.
 * createInstance(...)` — `PlainGlobalCompositeBar` (by `activitybarPart.js`'s
 * `ActivityBarCompositeBar`) and `PlainGlobalActivityActionViewItem` (by
 * `PlainGlobalCompositeBar` itself) — carry manual DI-dependency
 * registration below, mirroring `PlainSearchService`'s exact convention in
 * `app/features/search/plain-search-service.ts`: this repository does not
 * enable `experimentalDecorators`, so `@codingame/monaco-vscode-api`'s
 * `IFoo`-style decorator functions are called directly as
 * `IFoo(Ctor, undefined, <index>)`, redeclaring *every* dependency that
 * class's own constructor accepts — not only ones added beyond a base class
 * — because the DI container looks up dependencies via the *exact* class
 * passed to `createInstance`, not by walking the prototype chain. The
 * abstract base class below (`PlainAbstractGlobalActivityActionViewItem`) is
 * never itself passed to `createInstance` (only its concrete subclass is),
 * so it needs no such registration of its own — this is the same
 * "declare every constructor parameter's DI decorator on the class that is
 * actually constructed" discipline `scripts/plain/boundary-contracts.mjs`'s
 * `validateViewPaneDependencyDecoratorBoundary` mechanically enforces for
 * `ViewPane` subclasses (see that function's own doc comment for the two
 * real incidents this exact bug class already caused); this file is not a
 * `ViewPane`, so that specific contract does not reach it, but the
 * underlying risk — and the discipline required to avoid it — is identical.
 */

import {
	$,
	addDisposableListener,
	append,
	clearNode,
	EventHelper,
	EventType,
	getWindow,
	hide,
	show,
} from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { StandardKeyboardEvent } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/keyboardEvent";
import { StandardMouseEvent } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/mouseEvent";
import { EventType as TouchEventType } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/touch";
import {
	ActionBar,
	ActionsOrientation,
} from "@codingame/monaco-vscode-api/vscode/vs/base/browser/ui/actionbar/actionbar";
import "@codingame/monaco-vscode-api/vscode/vs/base/browser/ui/contextview/contextview";
import {
	Action,
	type IAction,
	toAction,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/actions";
import { KeyCode } from "@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes";
import {
	AnchorAlignment,
	AnchorAxisAlignment,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/layout";
import {
	Disposable,
	DisposableStore,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { ThemeIcon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/themables";
import { isString } from "@codingame/monaco-vscode-api/vscode/vs/base/common/types";
import { getActionBarActions } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/browser/menuEntryActionViewItem";
import {
	type IMenu,
	MenuId,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions.service";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import type { IColorTheme } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import {
	CompositeBarAction,
	CompositeBarActionViewItem,
	type IActivityHoverOptions,
	type ICompositeBarActionViewItemOptions,
	type ICompositeBarColors,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/compositeBarActions";
import { GLOBAL_ACTIVITY_ID } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/activity";
import {
	ACTIVITY_BAR_BADGE_BACKGROUND,
	ACTIVITY_BAR_BADGE_FOREGROUND,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/theme";
import { IActivityService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/activity/common/activity.service";
import { IUserDataProfileService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/userDataProfile/common/userDataProfile.service";
import { DEFAULT_ICON } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/userDataProfile/common/userDataProfileIcons";

type ContextMenuAlignmentOptions = () =>
	| Readonly<{
			anchorAlignment: AnchorAlignment;
			anchorAxisAlignment: AnchorAxisAlignment;
	  }>
	| undefined;

/**
 * Base for the one real Global Composite Bar action view item Plain keeps.
 * Mouse/keyboard/touch wiring and menu resolution ported unchanged from the
 * vendor `AbstractGlobalActivityActionViewItem`. Never itself passed to
 * `instantiationService.createInstance` (only `PlainGlobalActivityActionViewItem`
 * below is), so it declares no manual DI registration of its own — see this
 * module's own doc comment.
 */
abstract class PlainAbstractGlobalActivityActionViewItem extends CompositeBarActionViewItem {
	protected constructor(
		private readonly menuId: MenuId,
		// Typed as the concrete `CompositeBarAction` (not the inherited `action`
		// getter's `IAction`) purely so `.activities` below type-checks —
		// `BaseActionViewItem`'s own `action` getter widens to the generic
		// `IAction` interface, which does not declare it.
		protected readonly compositeBarAction: CompositeBarAction,
		options: ICompositeBarActionViewItemOptions,
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly contextMenuAlignmentOptions: ContextMenuAlignmentOptions,
		themeService: IThemeService,
		hoverService: IHoverService,
		private readonly menuService: IMenuService,
		private readonly contextMenuService: IContextMenuService,
		private readonly contextKeyService: IContextKeyService,
		configurationService: IConfigurationService,
		keybindingService: IKeybindingService,
		private readonly activityService: IActivityService,
	) {
		super(
			compositeBarAction,
			{ draggable: false, icon: true, hasPopup: true, ...options },
			() => true,
			themeService,
			hoverService,
			configurationService,
			keybindingService,
		);
		this.updateItemActivity();
		this._register(
			this.activityService.onDidChangeActivity((viewContainerOrAction) => {
				if (
					isString(viewContainerOrAction) &&
					viewContainerOrAction === this.compositeBarActionItem.id
				) {
					this.updateItemActivity();
				}
			}),
		);
	}

	private updateItemActivity(): void {
		this.compositeBarAction.activities = this.activityService.getActivity(
			this.compositeBarActionItem.id,
		);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this._register(
			addDisposableListener(
				container,
				EventType.MOUSE_DOWN,
				(e: MouseEvent) => {
					EventHelper.stop(e, true);
					const isLeftClick = e.button !== 2;
					if (isLeftClick) {
						this.run().catch(() => {
							// Best-effort: a failed menu resolution must not become an
							// unhandled promise rejection on this shared page (a prior
							// session's recorded lesson — see plain-debug-console-view.ts's
							// own `.catch()` for the same reasoning).
						});
					}
				},
			),
		);
		this._register(
			addDisposableListener(
				container,
				EventType.CONTEXT_MENU,
				(e: MouseEvent) => {
					e.stopPropagation();
					this.openContextMenu(container, e).catch(() => {
						// Best-effort, same reasoning as the mouse-down handler above.
					});
				},
			),
		);
		this._register(
			addDisposableListener(container, EventType.KEY_UP, (e: KeyboardEvent) => {
				const event = new StandardKeyboardEvent(e);
				if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
					EventHelper.stop(e, true);
					this.run().catch(() => {
						// Best-effort, same reasoning as the mouse-down handler above.
					});
				}
			}),
		);
		this._register(
			addDisposableListener(container, TouchEventType.Tap, (e: Event) => {
				EventHelper.stop(e, true);
				this.run().catch(() => {
					// Best-effort, same reasoning as the mouse-down handler above.
				});
			}),
		);
	}

	private async openContextMenu(
		container: HTMLElement,
		mouseEvent: MouseEvent,
	): Promise<void> {
		const disposables = new DisposableStore();
		const actions = await this.resolveContextMenuActions(disposables);
		const event = new StandardMouseEvent(getWindow(container), mouseEvent);
		this.contextMenuService.showContextMenu({
			getAnchor: () => event,
			getActions: () => actions,
			onHide: () => disposables.dispose(),
		});
	}

	protected async resolveContextMenuActions(
		_disposables: DisposableStore,
	): Promise<IAction[]> {
		return this.contextMenuActionsProvider();
	}

	private async run(): Promise<void> {
		const disposables = new DisposableStore();
		const menu = disposables.add(
			this.menuService.createMenu(this.menuId, this.contextKeyService),
		);
		const actions = await this.resolveMainMenuActions(menu, disposables);
		const alignment = this.contextMenuAlignmentOptions() ?? {
			anchorAlignment: undefined,
			anchorAxisAlignment: undefined,
		};
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.label,
			anchorAlignment: alignment.anchorAlignment,
			anchorAxisAlignment: alignment.anchorAxisAlignment,
			getActions: () => actions,
			onHide: () => disposables.dispose(),
			menuActionOptions: { renderShortTitle: true },
		});
	}

	protected async resolveMainMenuActions(
		menu: IMenu,
		_disposables: DisposableStore,
	): Promise<IAction[]> {
		return getActionBarActions(menu.getActions({ renderShortTitle: true }))
			.secondary;
	}
}

/**
 * The "Manage" gear itself — profile icon, profile badge, and the tooltip
 * that names the active profile when it is not the default one. Ported
 * unchanged from the vendor `GlobalActivityActionViewItem`, minus the unused
 * `environmentService` constructor parameter (see this module's own doc
 * comment).
 */
class PlainGlobalActivityActionViewItem extends PlainAbstractGlobalActivityActionViewItem {
	private profileBadge: HTMLElement | undefined;
	private profileBadgeContent: HTMLElement | undefined;

	constructor(
		contextMenuActionsProvider: () => IAction[],
		options: ICompositeBarActionViewItemOptions,
		contextMenuAlignmentOptions: ContextMenuAlignmentOptions,
		private readonly userDataProfileService: IUserDataProfileService,
		themeService: IThemeService,
		hoverService: IHoverService,
		menuService: IMenuService,
		contextMenuService: IContextMenuService,
		contextKeyService: IContextKeyService,
		configurationService: IConfigurationService,
		keybindingService: IKeybindingService,
		instantiationService: IInstantiationService,
		activityService: IActivityService,
	) {
		const action = instantiationService.createInstance(CompositeBarAction, {
			id: GLOBAL_ACTIVITY_ID,
			name: "Manage",
			classNames: ThemeIcon.asClassNameArray(
				userDataProfileService.currentProfile.icon
					? ThemeIcon.fromId(userDataProfileService.currentProfile.icon)
					: DEFAULT_ICON,
			),
		});
		super(
			MenuId.GlobalActivity,
			action,
			options,
			contextMenuActionsProvider,
			contextMenuAlignmentOptions,
			themeService,
			hoverService,
			menuService,
			contextMenuService,
			contextKeyService,
			configurationService,
			keybindingService,
			activityService,
		);
		this._register(action);
		this._register(
			this.userDataProfileService.onDidChangeCurrentProfile(() => {
				action.compositeBarActionItem = {
					...action.compositeBarActionItem,
					classNames: ThemeIcon.asClassNameArray(
						this.userDataProfileService.currentProfile.icon
							? ThemeIcon.fromId(
									this.userDataProfileService.currentProfile.icon,
								)
							: DEFAULT_ICON,
					),
				};
			}),
		);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this.profileBadge = append(container, $(".profile-badge"));
		this.profileBadgeContent = append(
			this.profileBadge,
			$(".profile-badge-content"),
		);
		this.updateProfileBadge();
	}

	private updateProfileBadge(): void {
		if (
			this.profileBadge === undefined ||
			this.profileBadgeContent === undefined
		) {
			return;
		}
		clearNode(this.profileBadgeContent);
		hide(this.profileBadge);
		const currentProfile = this.userDataProfileService.currentProfile;
		if (currentProfile.isDefault) {
			return;
		}
		if (currentProfile.icon && currentProfile.icon !== DEFAULT_ICON.id) {
			return;
		}
		if (this.compositeBarAction.activities.length > 0) {
			return;
		}
		show(this.profileBadge);
		this.profileBadgeContent.classList.add("profile-text-overlay");
		this.profileBadgeContent.textContent = currentProfile.name
			.substring(0, 2)
			.toUpperCase();
	}

	protected override updateActivity(): void {
		super.updateActivity();
		this.updateProfileBadge();
	}

	protected override computeTitle(): string {
		return this.userDataProfileService.currentProfile.isDefault
			? super.computeTitle()
			: `Manage ${this.userDataProfileService.currentProfile.name} (Profile)`;
	}
}

// Manual DI-dependency registration for the one leaf class this module ever
// passes to `instantiationService.createInstance` — see this module's own
// doc comment for why the abstract base class above needs none, and why
// every one of this class's own thirteen constructor parameters (not only
// the DI-injected ones) must be accounted for here, in order, matching
// `PlainSearchService`'s exact convention.
IUserDataProfileService(PlainGlobalActivityActionViewItem, undefined, 3);
IThemeService(PlainGlobalActivityActionViewItem, undefined, 4);
IHoverService(PlainGlobalActivityActionViewItem, undefined, 5);
IMenuService(PlainGlobalActivityActionViewItem, undefined, 6);
IContextMenuService(PlainGlobalActivityActionViewItem, undefined, 7);
IContextKeyService(PlainGlobalActivityActionViewItem, undefined, 8);
IConfigurationService(PlainGlobalActivityActionViewItem, undefined, 9);
IKeybindingService(PlainGlobalActivityActionViewItem, undefined, 10);
IInstantiationService(PlainGlobalActivityActionViewItem, undefined, 11);
IActivityService(PlainGlobalActivityActionViewItem, undefined, 12);

/**
 * The compact "Manage" gear variant rendered in the title bar (not the
 * Activity Bar): `titlebarPart.js`'s own `actionViewItemProvider` constructs
 * this whenever it is asked for `GLOBAL_ACTIVITY_ID` (i.e. whenever the title
 * bar's toolbar renders the Manage gear — see
 * `patches/@codingame__monaco-vscode-view-title-bar-service-override@35.0.1.patch`).
 * Ported from the vendor `SimpleGlobalActivityActionViewItem`, which is a
 * `GlobalActivityActionViewItem` subclass with a fixed, non-interactive
 * context menu (a single disabled "Manage" checkbox action, the same for
 * every caller regardless of arguments) instead of the real context-menu
 * resolution the Activity Bar variant gets. `environmentService`/
 * `storageService` dropped for the same reason
 * `PlainGlobalActivityActionViewItem`/`PlainGlobalCompositeBar` already drop
 * their own unused constructor parameters — see this module's top doc
 * comment.
 */
export class PlainSimpleGlobalActivityActionViewItem extends PlainGlobalActivityActionViewItem {
	constructor(
		hoverOptions: IActivityHoverOptions,
		options: ICompositeBarActionViewItemOptions,
		userDataProfileService: IUserDataProfileService,
		themeService: IThemeService,
		hoverService: IHoverService,
		menuService: IMenuService,
		contextMenuService: IContextMenuService,
		contextKeyService: IContextKeyService,
		configurationService: IConfigurationService,
		keybindingService: IKeybindingService,
		instantiationService: IInstantiationService,
		activityService: IActivityService,
	) {
		super(
			simpleGlobalActivityContextMenuActions,
			{
				...options,
				colors: (theme) => ({
					badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
					badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
				}),
				hoverOptions,
				compact: true,
			},
			() => undefined,
			userDataProfileService,
			themeService,
			hoverService,
			menuService,
			contextMenuService,
			contextKeyService,
			configurationService,
			keybindingService,
			instantiationService,
			activityService,
		);
	}
}

function simpleGlobalActivityContextMenuActions(): IAction[] {
	return [
		toAction({
			id: "toggle.hideManage",
			label: "Manage",
			checked: true,
			enabled: false,
			run: () => {
				throw new Error('"Manage" can not be hidden');
			},
		}),
	];
}

// Manual DI-dependency registration — see this module's own doc comment.
IUserDataProfileService(PlainSimpleGlobalActivityActionViewItem, undefined, 2);
IThemeService(PlainSimpleGlobalActivityActionViewItem, undefined, 3);
IHoverService(PlainSimpleGlobalActivityActionViewItem, undefined, 4);
IMenuService(PlainSimpleGlobalActivityActionViewItem, undefined, 5);
IContextMenuService(PlainSimpleGlobalActivityActionViewItem, undefined, 6);
IContextKeyService(PlainSimpleGlobalActivityActionViewItem, undefined, 7);
IConfigurationService(PlainSimpleGlobalActivityActionViewItem, undefined, 8);
IKeybindingService(PlainSimpleGlobalActivityActionViewItem, undefined, 9);
IInstantiationService(PlainSimpleGlobalActivityActionViewItem, undefined, 10);
IActivityService(PlainSimpleGlobalActivityActionViewItem, undefined, 11);

/**
 * Replaces the vendor `GlobalCompositeBar` as the Activity Bar's bottom
 * composite bar. Constructed by `activitybarPart.js`'s `ActivityBarCompositeBar`
 * via `instantiationService.createInstance(PlainGlobalCompositeBar,
 * contextMenuActionsProvider, colorsFn, activityHoverOptions)` — three
 * explicit arguments, matching the vendor call site unchanged; only the
 * import target and class name differ (see
 * `patches/@codingame__monaco-vscode-api@35.0.1.patch`).
 */
export class PlainGlobalCompositeBar extends Disposable {
	readonly element: HTMLElement;
	private readonly globalActivityAction: Action;
	private readonly globalActivityActionBar: ActionBar;

	constructor(
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly colors: (theme: IColorTheme) => ICompositeBarColors,
		private readonly activityHoverOptions: IActivityHoverOptions,
		configurationService: IConfigurationService,
		private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.globalActivityAction = this._register(new Action(GLOBAL_ACTIVITY_ID));
		this.element = $("div");
		const contextMenuAlignmentOptions: ContextMenuAlignmentOptions = () => ({
			anchorAlignment:
				configurationService.getValue("workbench.sideBar.location") === "left"
					? AnchorAlignment.RIGHT
					: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.HORIZONTAL,
		});
		this.globalActivityActionBar = this._register(
			new ActionBar(this.element, {
				actionViewItemProvider: (action, options) => {
					if (action.id === GLOBAL_ACTIVITY_ID) {
						return this.instantiationService.createInstance(
							PlainGlobalActivityActionViewItem,
							this.contextMenuActionsProvider,
							{
								...options,
								colors: this.colors,
								hoverOptions: this.activityHoverOptions,
							},
							contextMenuAlignmentOptions,
						);
					}
					throw new Error(`No view item for action '${action.id}'`);
				},
				orientation: ActionsOrientation.VERTICAL,
				ariaLabel: "Manage",
				preventLoopNavigation: true,
			}),
		);
		this.globalActivityActionBar.push(this.globalActivityAction);
	}

	create(parent: HTMLElement): void {
		parent.appendChild(this.element);
	}

	focus(): void {
		this.globalActivityActionBar.focus(true);
	}

	size(): number {
		return this.globalActivityActionBar.viewItems.length;
	}

	getContextMenuActions(): IAction[] {
		return [];
	}
}

// Manual DI-dependency registration — see this module's own doc comment.
// `contextMenuActionsProvider`/`colors`/`activityHoverOptions` (indices 0-2)
// are explicit arguments `ActivityBarCompositeBar` passes directly, exactly
// like the vendor call site; only `configurationService`/`instantiationService`
// (indices 3-4) are DI-injected. `storageService`/`extensionService` (the
// vendor's own indices 5-6) are gone along with the account branch that was
// their only use.
IConfigurationService(PlainGlobalCompositeBar, undefined, 3);
IInstantiationService(PlainGlobalCompositeBar, undefined, 4);
