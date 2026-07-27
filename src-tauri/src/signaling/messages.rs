use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    Offer {
        to: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        sdp: String,
    },

    #[serde(rename = "answer")]
    Answer {
        to: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        sdp: String,
    },

    #[serde(rename = "ice")]
    Ice {
        to: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        candidate: String,
    },

    #[serde(rename = "chat")]
    Chat {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_id: Option<String>,
        nickname: String,
        text: String,
        timestamp: u64,
    },

    #[serde(rename = "chat_history")]
    ChatHistory { messages: Vec<ChatMessageData> },

    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeerInfo {
    pub id: String,
    pub nickname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessageData {
    pub from_id: String,
    pub nickname: String,
    pub text: String,
    pub timestamp: u64,
}
