pub mod commands;
pub mod crypto;
pub mod room;
pub mod signaling;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::crypto_commands::CryptoState::new())
        .setup(|_app| {
            tauri::async_runtime::spawn(async move {
                let server = signaling::server::SignalingServer::new();
                if let Err(e) = server.start("127.0.0.1:9876").await {
                    eprintln!("[Signaling] Server error: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::room_commands::create_room,
            commands::room_commands::join_room,
            commands::room_commands::leave_room,
            commands::room_commands::get_room_code,
            commands::room_commands::set_nickname,
            commands::crypto_commands::get_public_key,
            commands::crypto_commands::get_fingerprint,
            commands::crypto_commands::verify_peer_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

