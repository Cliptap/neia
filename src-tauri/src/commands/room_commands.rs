use crate::room::code;

#[tauri::command]
pub fn create_room() -> Result<String, String> {
    let code = code::generate_room_code();
    Ok(code)
}

#[tauri::command]
pub fn join_room(room_code: String) -> Result<String, String> {
    if code::validate_room_code(&room_code) {
        Ok(room_code)
    } else {
        Err("Invalid room code format. Use 6 characters from: 2-9, A-H, J-N, P-Z".into())
    }
}

#[tauri::command]
pub fn leave_room() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_room_code() -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub fn set_nickname(nickname: String) -> Result<String, String> {
    if nickname.is_empty() || nickname.len() > 20 {
        return Err("Nickname must be 1-20 characters".into());
    }
    Ok(nickname)
}
