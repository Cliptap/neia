use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalMessage {
    #[serde(rename = "join")]
    Join { room: String, nickname: String },

    #[serde(rename = "peers")]
    Peers { peers: Vec<PeerInfo> },

    #[serde(rename = "peer_joined")]
    PeerJoined { peer: PeerInfo },

    #[serde(rename = "peer_left")]
    PeerLeft { peer_id: String },

    #[serde(rename = "offer")]
    Offer { to: String, sdp: String },

    #[serde(rename = "answer")]
    Answer { to: String, sdp: String },

    #[serde(rename = "ice")]
    Ice { to: String, candidate: String },

    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub id: String,
    pub nickname: String,
}
