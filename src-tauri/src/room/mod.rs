use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub mod code;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub id: String,
    pub nickname: String,
}

#[derive(Debug, Clone)]
pub struct RoomState {
    pub code: String,
    pub peers: HashMap<String, PeerInfo>,
    pub created_at: std::time::Instant,
}

#[derive(Debug, Clone)]
pub struct SessionState {
    pub nickname: String,
    pub peer_id: String,
    pub room: Option<RoomState>,
}

impl SessionState {
    pub fn new(nickname: String) -> Self {
        Self {
            nickname,
            peer_id: uuid::Uuid::new_v4().to_string(),
            room: None,
        }
    }
}

pub type SharedSession = Arc<Mutex<SessionState>>;

pub fn create_shared_session(nickname: String) -> SharedSession {
    Arc::new(Mutex::new(SessionState::new(nickname)))
}
