use tauri::{Emitter, Manager};

pub mod backup;
pub mod error;
pub mod git;
pub mod path_policy;
pub mod search;
pub mod terminal;
pub mod theme;
pub mod trust;
pub mod workspace;

use backup::service::BackupService;
use error::CommandError;
use git::network::GitNetworkService;
use terminal::service::TerminalService;
use theme::service::ThemeService;
use trust::service::TrustService;
use workspace::service::WorkspaceService;

const RUNTIME_READY_EVENT: &str = "plain://runtime-ready";

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    application: &'static str,
    ipc_version: u16,
    runtime: &'static str,
}

fn runtime_info_payload() -> RuntimeInfo {
    RuntimeInfo {
        application: "Plain",
        ipc_version: 1,
        runtime: "tauri",
    }
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle) -> Result<RuntimeInfo, CommandError> {
    let payload = runtime_info_payload();
    app.emit(RUNTIME_READY_EVENT, payload.clone())
        .map_err(|error| CommandError::new("EVENT_EMIT_FAILED", error.to_string()))?;
    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkspaceService::new())
        .manage(TerminalService::new())
        .manage(GitNetworkService::new())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let base_path = app.path().app_local_data_dir()?;
            app.manage(BackupService::new(base_path.clone()));
            app.manage(ThemeService::new(base_path.clone()));
            app.manage(TrustService::new(base_path));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<WorkspaceService>()
                    .close_window(window.label());
                window.state::<BackupService>().close_window(window.label());
                window
                    .state::<TerminalService>()
                    .close_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            workspace::commands::workspace_capabilities,
            workspace::commands::workspace_snapshot,
            workspace::commands::workspace_pick_roots,
            workspace::commands::workspace_watch_sync,
            workspace::commands::workspace_remove_root,
            workspace::commands::workspace_stat,
            workspace::commands::workspace_read_dir,
            workspace::commands::workspace_read_file,
            workspace::commands::workspace_write_file,
            workspace::commands::workspace_create_file,
            workspace::commands::workspace_create_directory,
            workspace::commands::workspace_rename,
            workspace::commands::workspace_copy,
            workspace::commands::workspace_move,
            workspace::commands::workspace_prepare_delete,
            workspace::commands::workspace_cancel_delete,
            workspace::commands::workspace_begin_delete,
            workspace::commands::workspace_commit_delete_entry,
            git::commands::git_status,
            git::commands::git_diff_files,
            git::commands::git_show_blob,
            git::commands::git_stage_paths,
            git::commands::git_unstage_paths,
            git::commands::git_stage_blob,
            git::commands::git_commit,
            git::commands::git_discard_paths,
            git::commands::git_network_preview,
            git::commands::git_fetch,
            git::commands::git_pull,
            git::commands::git_push,
            git::commands::git_network_cancel,
            git::commands::git_blame_file,
            git::commands::git_blame_commit_messages,
            git::commands::git_file_history,
            git::commands::git_line_history_list,
            git::commands::git_line_history_detail,
            git::commands::git_show_commit,
            git::commands::git_show_commit_blob,
            git::commands::git_log_graph,
            git::commands::git_refs_list,
            git::commands::git_stash_list,
            git::commands::git_stash_show,
            git::commands::git_stash_push,
            git::commands::git_stash_apply,
            git::commands::git_stash_pop,
            git::commands::git_stash_drop,
            search::commands::workspace_search_files,
            search::commands::workspace_search_text_start,
            search::commands::workspace_search_text_poll,
            search::commands::workspace_search_text_cancel,
            backup::commands::backup_write,
            backup::commands::backup_read_all,
            backup::commands::backup_discard,
            backup::commands::backup_discard_all,
            trust::commands::workspace_trust_state,
            trust::commands::workspace_trust_grant,
            trust::commands::workspace_trust_revoke,
            terminal::commands::terminal_start,
            terminal::commands::terminal_input_text,
            terminal::commands::terminal_input_key,
            terminal::commands::terminal_focus,
            terminal::commands::terminal_resize,
            terminal::commands::terminal_ack,
            terminal::commands::terminal_scrollback,
            terminal::commands::terminal_kill,
            theme::commands::theme_import_vsix,
            theme::commands::theme_import_directory,
            theme::commands::theme_list,
            theme::commands::theme_read_resource,
            theme::commands::theme_remove,
            theme::commands::theme_get_selection,
            theme::commands::theme_set_selection,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Plain")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Resumed) {
                app.state::<WorkspaceService>().mark_all_watchers_rescan();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::runtime_info_payload;

    #[test]
    fn runtime_info_contract_is_camel_case_and_versioned() {
        let value = serde_json::to_value(runtime_info_payload()).expect("runtime info serializes");
        assert_eq!(value["application"], "Plain");
        assert_eq!(value["ipcVersion"], 1);
        assert_eq!(value["runtime"], "tauri");
        assert!(value.get("ipc_version").is_none());
    }
}
