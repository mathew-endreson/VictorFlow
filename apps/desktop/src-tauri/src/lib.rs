// The desktop app is a thin native shell around the React front-end, which talks over the LAN to the shop's VictorFlow
// server (apps/server-host installs the API, PostgreSQL, the tracker and the TV displays there as Windows services).
// Nothing runs in the background here: no database, no API, no child process. The only plugin is `opener`, which
// lets the UI hand an http(s) link (the customer tracking link) to the system browser, since a Tauri window ignores
// target="_blank". Which server to use is a setting in the UI (sign-in screen, or the "cannot reach the server"
// screen), not something this shell knows about.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running the VictorFlow desktop app");
}
