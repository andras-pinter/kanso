// Wave 3 (Session E) will:
//   - add tauri + tauri-build deps and tauri.conf.json
//   - init Tauri 2, mount the React/BlockSuite UI from ../../ui/dist
//   - open the sqlx pool via kanso_core::db::open(app_data_dir)
//   - mount kanso_api::router(AppState { pool }) in-process on a loopback port
//   - register Tauri commands that delegate to kanso_core repos
//   - write the chosen port + a session token into app_data for kanso-cli-ext

fn main() {
    println!("kanso-tauri placeholder (Wave 3 wires Tauri 2)");
}
