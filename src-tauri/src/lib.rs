use tauri::Manager;

pub mod commands;
pub mod crypto;
pub mod room;
pub mod signaling;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::crypto_commands::CryptoState::new())
        .setup(|app| {
            tauri::async_runtime::spawn(async move {
                let server = signaling::server::SignalingServer::new();
                if let Err(e) = server.start("127.0.0.1:9876").await {
                    eprintln!("[Signaling] Server error: {}", e);
                }
            });

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    #[cfg(target_os = "windows")]
                    unsafe {
                        use webview2_com::PermissionRequestedEventHandler;
                        use webview2_com::Microsoft::Web::WebView2::Win32::*;

                        if let Ok(core) = webview.controller().CoreWebView2() {
                            let mut token: i64 = 0;
                            let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                                if let Some(args) = args {
                                    let mut kind = COREWEBVIEW2_PERMISSION_KIND_MICROPHONE;
                                    let _ = args.PermissionKind(&mut kind);
                                    if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                        || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                                    {
                                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                                    }
                                }
                                Ok(())
                            }));
                            let _ = core.add_PermissionRequested(&handler, &mut token);
                        }
                    }
                });
            }

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
