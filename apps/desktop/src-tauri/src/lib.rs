// The desktop app is a thin native shell: all business logic lives in the React front-end and the HTTP API.
// No custom Tauri commands are exposed on purpose (smaller attack surface). The only plugin is `opener`, which lets the UI
// hand an http(s) link (the customer tracking link) to the system browser — a Tauri window ignores target="_blank".
// MVP-NOTE: anything else that needs the OS — e.g. keeping the refresh token in the system keychain — would be added here
// as a narrowly-scoped command + capability.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running the VictorFlow desktop app");
}
