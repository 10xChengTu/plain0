use tauri::Emitter;

pub mod error;
pub mod path_policy;
pub mod workspace;

use error::CommandError;

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
        .invoke_handler(tauri::generate_handler![runtime_info])
        .run(tauri::generate_context!())
        .expect("failed to run Plain");
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
