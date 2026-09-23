// The desktop app is a thin native shell: all business logic lives in the React front-end and the HTTP API.
// The only Tauri command exposed on purpose is `get_backend_status` (read-only, no arguments, no attack
// surface) — everything else is still just the `opener` plugin, which lets the UI hand an http(s) link (the
// customer tracking link) to the system browser, since a Tauri window ignores target="_blank".
//
// On startup this shell spawns ONE child process — the backend launcher (apps/desktop/src-tauri/sidecar/
// launcher.mjs, running under a bundled Node runtime) — which brings up embedded PostgreSQL, migrates, and
// boots the NestJS API, reporting progress as newline-delimited JSON on its stdout. Rust's only job here is
// process supervision: spawn it, relay each status line to the webview as a `backend-status` event, and shut
// it down cleanly on exit. See the sidecar design notes in the project conversation history for why: the data
// directory (not the port) is the source of truth for Postgres identity, and readiness is proven by a real
// query / a real health-check poll, never by "the process exists" or "the port is listening".
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// node.exe is a console-subsystem binary; spawned from this GUI-subsystem (windowless) app, Windows
/// would otherwise flash a visible console window for it (the same reason launcher.mjs itself passes
/// `windowsHide: true` to every process IT spawns — initdb, pg_ctl, tasklist, powershell, and the API's
/// own node.exe child).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendState {
    child: Mutex<Option<Child>>,
    last_status: Mutex<Option<String>>,
}

/// One read-only snapshot for a freshly-mounted splash screen to pull on first render, so it never misses
/// the "ready" event just because it attached its listener a moment after the backend already reported it.
/// Ongoing updates still come from the `backend-status` event stream.
#[tauri::command]
fn get_backend_status(state: State<BackendState>) -> Option<String> {
    state.last_status.lock().unwrap().clone()
}

/// (node executable, launcher script, resources dir to pass through as VF_RESOURCES_DIR)
///
/// Dev/testing override: VF_LAUNCHER_NODE + VF_LAUNCHER_SCRIPT env vars, set by whoever runs `tauri dev`.
/// In that mode VF_RESOURCES_DIR is deliberately NOT computed here — if the launching shell exported it,
/// normal environment inheritance carries it through; if not, the launcher falls back to resolving
/// everything from the monorepo checkout itself (its own dev/testing mode). Production has no shell to
/// export anything from, so it always resolves from the bundled resource directory instead.
fn resolve_launcher(app: &tauri::App) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
    if let (Ok(node), Ok(script)) = (env::var("VF_LAUNCHER_NODE"), env::var("VF_LAUNCHER_SCRIPT")) {
        return Ok((PathBuf::from(node), PathBuf::from(script), None));
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| format!("could not resolve the app resource directory: {e}"))?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok((resources.join("node").join(node_name), resources.join("launcher.mjs"), Some(resources)))
}

/// Resolves and creates the one mutable directory the whole backend uses (Postgres data, secrets, the
/// API's own storage) — separate from `spawn_backend` so `run()` can log to it even if spawning fails.
fn app_data_dir(app: &tauri::App) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    Ok(dir)
}

/// Appends one line to `backend-status.log` in the app data directory — the persistent record of the
/// launcher's own top-level progress (setting-up / starting-db / migrating / starting-api / ready / error)
/// plus its stderr, independent of the live `backend-status` event stream. Exists because a release build
/// has no visible console (`windows_subsystem = "windows"`) for `eprintln!` to reach, and the event stream
/// alone can't be inspected after the fact if the app is stuck rather than crashed.
fn log_line(app_data_dir: &Path, line: &str) {
    let path = app_data_dir.join("backend-status.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        // No chrono dependency for one timestamp — SystemTime's Debug output is a little ugly but
        // entirely sufficient for "which of these lines came first" while reading a log file.
        let _ = writeln!(f, "{:?} {line}", std::time::SystemTime::now());
    }
}

/// Windows-only: `resource_dir()`/`current_exe()`-derived paths come back with the `\\?\` extended-length
/// prefix. Rust's own std::fs handles that prefix fine, but Node.js's *internal module-resolution* code
/// does not — passing one as the main-script argument reproducibly crashes Node before a single line of
/// launcher.mjs runs, with `EISDIR: illegal operation on a directory, lstat 'C:'` from deep inside
/// `resolveMainPath`/`_findPath` (confirmed via backend-status.log on a real install: the crash happens at
/// Node startup, before this app's own `emit('setting-up')` — which is also why it never reaches an error
/// screen, just an indefinitely stuck splash). Bundled resource paths are always well under MAX_PATH, so
/// stripping the prefix before handing anything to node.exe (as argv or env) is safe. Rust's own path
/// operations (exists() checks, directory creation, log writes) keep using the untouched original paths.
fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    match path.to_str() {
        Some(s) if s.starts_with(r"\\?\") => PathBuf::from(&s[4..]),
        _ => path.to_path_buf(),
    }
}

fn spawn_backend(app: &tauri::App, app_data_dir: &Path) -> Result<Child, String> {
    let (node_exe, launcher_script, resources_dir) = resolve_launcher(app)?;
    if !node_exe.exists() {
        return Err(format!("bundled Node runtime not found at {node_exe:?}"));
    }
    if !launcher_script.exists() {
        return Err(format!("backend launcher script not found at {launcher_script:?}"));
    }

    let mut cmd = Command::new(strip_verbatim_prefix(&node_exe));
    cmd.arg(strip_verbatim_prefix(&launcher_script))
        .env("VF_APP_DATA_DIR", strip_verbatim_prefix(app_data_dir))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(resources) = resources_dir {
        cmd.env("VF_RESOURCES_DIR", strip_verbatim_prefix(&resources));
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn().map_err(|e| format!("failed to spawn the backend launcher: {e}"))
}

/// Sends the backend a clean-shutdown request over its stdin (see launcher.mjs — this is deliberately not
/// signal-based: SIGTERM cannot be listened for on Windows, so a console-less child can't reliably receive
/// one either), waits briefly for it to exit on its own so Postgres gets a chance to shut down cleanly, and
/// only force-kills as a last resort.
fn shutdown_backend(mut child: Child) {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"shutdown\n");
    }
    child.stdin.take(); // drop → close the pipe, in case the write alone isn't read as a full line

    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(150)),
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(BackendState { child: Mutex::new(None), last_status: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![get_backend_status])
        .setup(|app| {
            let handle = app.handle().clone();

            let data_dir = match app_data_dir(app) {
                Ok(dir) => dir,
                Err(message) => {
                    // Can't even log to a file without the data dir, but the event/state path still works.
                    let line = format!(r#"{{"status":"error","code":"APP_DATA_DIR_FAILED","message":{message:?}}}"#);
                    *app.state::<BackendState>().last_status.lock().unwrap() = Some(line.clone());
                    let _ = handle.emit("backend-status", line);
                    return Ok(());
                }
            };

            match spawn_backend(app, &data_dir) {
                Ok(mut child) => {
                    let stdout = child.stdout.take().expect("piped stdout");
                    let stderr = child.stderr.take().expect("piped stderr");

                    let out_handle = handle.clone();
                    let out_dir = data_dir.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                            log_line(&out_dir, &line);
                            if let Some(state) = out_handle.try_state::<BackendState>() {
                                *state.last_status.lock().unwrap() = Some(line.clone());
                            }
                            let _ = out_handle.emit("backend-status", line);
                        }
                    });
                    let err_dir = data_dir.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                            log_line(&err_dir, &format!("[stderr] {line}"));
                            eprintln!("[backend] {line}");
                        }
                    });

                    *app.state::<BackendState>().child.lock().unwrap() = Some(child);
                }
                Err(message) => {
                    // Don't panic the whole shell over a spawn failure — report it the same way the
                    // launcher itself reports errors, so one splash-screen code path handles both.
                    let line = format!(r#"{{"status":"error","code":"SPAWN_FAILED","message":{message:?}}}"#);
                    log_line(&data_dir, &line);
                    *app.state::<BackendState>().last_status.lock().unwrap() = Some(line.clone());
                    let _ = handle.emit("backend-status", line);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the VictorFlow desktop app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        shutdown_backend(child);
                    }
                }
            }
        });
}
