use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

use super::{layout_invalid, layout_too_large};

pub(crate) const MAX_LAYOUT_ENTRIES: usize = 128;
pub(crate) const MAX_LAYOUT_KEY_BYTES: usize = 256;
pub(crate) const MAX_LAYOUT_VALUE_BYTES: usize = 64 * 1024;
pub(crate) const MAX_LAYOUT_TOTAL_VALUE_BYTES: usize = 512 * 1024;

const PROFILE_EXACT_KEYS: &[&str] = &[
    "views.customizations",
    "workbench.auxiliaryBar.empty",
    "workbench.auxiliaryBar.lastNonMaximizedSize",
    "workbench.auxiliaryBar.size",
    "workbench.panel.alignment",
    "workbench.panel.lastNonMaximizedHeight",
    "workbench.panel.lastNonMaximizedWidth",
    "workbench.panel.placeholderPanels",
    "workbench.panel.pinnedPanels",
    "workbench.panel.size",
    "workbench.sideBar.size",
    "workbench.activity.pinnedViewlets2",
    "workbench.activity.placeholderViewlets",
    "workbench.auxiliarybar.pinnedPanels",
    "workbench.auxiliarybar.placeholderPanels",
];

const WORKSPACE_EXACT_KEYS: &[&str] = &[
    "workbench.activityBar.hidden",
    "workbench.auxiliaryBar.hidden",
    "workbench.auxiliaryBar.lastNonMaximizedVisibility",
    "workbench.auxiliaryBar.wasLastMaximized",
    "workbench.editor.centered",
    "workbench.editor.hidden",
    "workbench.panel.hidden",
    "workbench.panel.position",
    "workbench.panel.wasLastMaximized",
    "workbench.sideBar.hidden",
    "workbench.sideBar.position",
    "workbench.statusBar.hidden",
    "workbench.zenMode.active",
    "workbench.zenMode.exitInfo",
    "workbench.sidebar.activeviewletid",
    "workbench.panelpart.activepanelid",
    "workbench.auxiliarybar.activepanelid",
    "workbench.activity.viewletsWorkspaceState",
    "workbench.panel.viewContainersWorkspaceState",
    "workbench.auxiliarybar.viewContainersWorkspaceState",
];

const VIEW_STORAGE_IDS: &[&str] = &[
    "workbench.explorer.views.state",
    "workbench.view.search",
    "plain.workbench.viewContainer.scm",
    "plain.workbench.viewContainer.terminal",
    "plain.workbench.viewContainer.debug",
    "plain.workbench.viewContainer.debugConsole",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutStorageScope {
    Profile,
    Workspace,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutStorageEntry {
    scope: LayoutStorageScope,
    key: String,
    value: String,
}

impl LayoutStorageEntry {
    #[cfg(test)]
    pub(crate) fn new(scope: LayoutStorageScope, key: String, value: String) -> Self {
        Self { scope, key, value }
    }

    pub(crate) const fn scope(&self) -> LayoutStorageScope {
        self.scope
    }

    pub(crate) fn key(&self) -> &str {
        &self.key
    }

    pub(crate) fn value(&self) -> &str {
        &self.value
    }

    pub(crate) fn validate(&self) -> Result<(), CommandError> {
        if self.key.is_empty()
            || self.key.len() > MAX_LAYOUT_KEY_BYTES
            || self.value.len() > MAX_LAYOUT_VALUE_BYTES
            || !is_allowed_layout_key(self.scope, &self.key)
        {
            return Err(if self.value.len() > MAX_LAYOUT_VALUE_BYTES {
                layout_too_large()
            } else {
                layout_invalid()
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutStorageSnapshot {
    workspace_available: bool,
    entries: Vec<LayoutStorageEntry>,
}

impl LayoutStorageSnapshot {
    pub(crate) fn new(workspace_available: bool, entries: Vec<LayoutStorageEntry>) -> Self {
        Self {
            workspace_available,
            entries,
        }
    }

    pub(crate) fn into_entries(self) -> Vec<LayoutStorageEntry> {
        self.entries
    }

    pub(crate) fn entries(&self) -> &[LayoutStorageEntry] {
        &self.entries
    }

    pub(crate) fn validate(&self) -> Result<(), CommandError> {
        if self.entries.len() > MAX_LAYOUT_ENTRIES {
            return Err(layout_too_large());
        }
        let mut identities = HashSet::with_capacity(self.entries.len());
        let mut total = 0_usize;
        for entry in &self.entries {
            entry.validate()?;
            if !identities.insert((entry.scope(), entry.key())) {
                return Err(layout_invalid());
            }
            total = total
                .checked_add(entry.value().len())
                .ok_or_else(layout_too_large)?;
        }
        if total > MAX_LAYOUT_TOTAL_VALUE_BYTES {
            return Err(layout_too_large());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutReadRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutWriteRequest {
    entries: Vec<LayoutStorageEntry>,
}

impl LayoutWriteRequest {
    pub(crate) fn into_entries(self) -> Result<Vec<LayoutStorageEntry>, CommandError> {
        let snapshot = LayoutStorageSnapshot::new(false, self.entries);
        snapshot.validate()?;
        Ok(snapshot.into_entries())
    }
}

pub(crate) fn is_allowed_layout_key(scope: LayoutStorageScope, key: &str) -> bool {
    let exact = match scope {
        LayoutStorageScope::Profile => PROFILE_EXACT_KEYS,
        LayoutStorageScope::Workspace => WORKSPACE_EXACT_KEYS,
    };
    if exact.contains(&key) {
        return true;
    }
    VIEW_STORAGE_IDS.iter().any(|storage_id| match scope {
        LayoutStorageScope::Profile => key == format!("{storage_id}.hidden"),
        LayoutStorageScope::Workspace => {
            key == *storage_id || key == format!("{storage_id}.numberOfVisibleViews")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_is_scope_specific_and_rejects_generic_storage() {
        assert!(is_allowed_layout_key(
            LayoutStorageScope::Workspace,
            "workbench.sideBar.hidden"
        ));
        assert!(is_allowed_layout_key(
            LayoutStorageScope::Profile,
            "views.customizations"
        ));
        assert!(is_allowed_layout_key(
            LayoutStorageScope::Workspace,
            "plain.workbench.viewContainer.scm.numberOfVisibleViews"
        ));
        assert!(!is_allowed_layout_key(
            LayoutStorageScope::Profile,
            "workbench.sideBar.hidden"
        ));
        assert!(!is_allowed_layout_key(
            LayoutStorageScope::Workspace,
            "history.entries"
        ));
        assert!(!is_allowed_layout_key(
            LayoutStorageScope::Profile,
            "authentication.session"
        ));
    }

    #[test]
    fn write_request_rejects_duplicates_unknown_fields_and_limits() {
        let duplicate = serde_json::from_value::<LayoutWriteRequest>(serde_json::json!({
            "entries": [
                {"scope":"profile","key":"views.customizations","value":"{}"},
                {"scope":"profile","key":"views.customizations","value":"{}"}
            ]
        }))
        .expect("wire shape");
        assert_eq!(
            duplicate.into_entries().unwrap_err().code(),
            "LAYOUT_INVALID"
        );
        assert!(
            serde_json::from_value::<LayoutReadRequest>(serde_json::json!({"extra": true}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<LayoutWriteRequest>(serde_json::json!({
                "entries": [],
                "extra": true
            }))
            .is_err()
        );
        let too_large = LayoutStorageSnapshot::new(
            false,
            vec![LayoutStorageEntry::new(
                LayoutStorageScope::Profile,
                "views.customizations".to_owned(),
                "x".repeat(MAX_LAYOUT_VALUE_BYTES + 1),
            )],
        );
        assert_eq!(too_large.validate().unwrap_err().code(), "LAYOUT_TOO_LARGE");
    }
}
