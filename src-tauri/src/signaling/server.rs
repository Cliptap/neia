use crate::signaling::messages;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::Message;

type RoomBroadcasts = HashMap<String, broadcast::Sender<String>>;
type ChatHistories = HashMap<String, Vec<messages::ChatMessageData>>;

pub struct SignalingServer {
    rooms: Arc<Mutex<RoomBroadcasts>>,
    peers: Arc<Mutex<HashMap<String, String>>>,
    chat_histories: Arc<Mutex<ChatHistories>>,
}

impl SignalingServer {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            peers: Arc::new(Mutex::new(HashMap::new())),
            chat_histories: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(addr).await?;
        println!("[Signaling] Server listening on {}", addr);

        loop {
            let (stream, addr) = listener.accept().await?;
            println!("[Signaling] New connection from: {}", addr);

            let rooms = self.rooms.clone();
            let peers = self.peers.clone();
            let chat_histories = self.chat_histories.clone();

            tokio::spawn(async move {
                if let Err(e) = Self::handle_connection(stream, rooms, peers, chat_histories).await {
                    eprintln!("[Signaling] Connection error: {}", e);
                }
            });
        }
    }

    async fn handle_connection(
        stream: TcpStream,
        rooms: Arc<Mutex<RoomBroadcasts>>,
        peers: Arc<Mutex<HashMap<String, String>>>,
        chat_histories: Arc<Mutex<ChatHistories>>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        let (mut writer, mut reader) = ws_stream.split();

        let mut peer_id = String::new();
        let mut current_room: Option<String> = None;
        let mut rx: Option<broadcast::Receiver<String>> = None;

        loop {
            tokio::select! {
                Some(msg) = reader.next() => {
                    let msg = msg?;
                    if !msg.is_text() {
                        continue;
                    }

                    let text = msg.to_string();
                    if let Ok(signal_msg) = serde_json::from_str::<messages::SignalMessage>(&text) {
                        match signal_msg {
                            messages::SignalMessage::Join { room, nickname } => {
                                peer_id = uuid::Uuid::new_v4().to_string();
                                peers.lock().await.insert(peer_id.clone(), nickname.clone());

                                let mut rooms_lock = rooms.lock().await;
                                let tx = rooms_lock.entry(room.clone()).or_insert_with(|| {
                                    let (tx, _) = broadcast::channel::<String>(100);
                                    tx
                                }).clone();
                                rx = Some(tx.subscribe());
                                drop(rooms_lock);

                                current_room = Some(room.clone());

                                // Send list of existing peers to the new peer
                                let peers_list = Self::get_room_peers(&peers, &peer_id).await;
                                let peers_msg = messages::SignalMessage::Peers { peers: peers_list };
                                writer.send(Message::Text(serde_json::to_string(&peers_msg)?.into())).await?;

                                // Send existing chat history to the new peer
                                let history = {
                                    let history_lock = chat_histories.lock().await;
                                    history_lock.get(&room).cloned().unwrap_or_default()
                                };
                                if !history.is_empty() {
                                    let history_msg = messages::SignalMessage::ChatHistory { messages: history };
                                    writer.send(Message::Text(serde_json::to_string(&history_msg)?.into())).await?;
                                }

                                // Broadcast peer_joined to other room members
                                let join_msg = messages::SignalMessage::PeerJoined {
                                    peer: messages::PeerInfo {
                                        id: peer_id.clone(),
                                        nickname,
                                    },
                                };
                                Self::broadcast_msg(&rooms, &room, &join_msg).await;
                            }
                            messages::SignalMessage::Offer { to, sdp, .. } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Offer {
                                        to,
                                        from: Some(peer_id.clone()),
                                        sdp,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
                                }
                            }
                            messages::SignalMessage::Answer { to, sdp, .. } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Answer {
                                        to,
                                        from: Some(peer_id.clone()),
                                        sdp,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
                                }
                            }
                            messages::SignalMessage::Ice { to, candidate, .. } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Ice {
                                        to,
                                        from: Some(peer_id.clone()),
                                        candidate,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
                                }
                            }
                            messages::SignalMessage::Chat { nickname, text, timestamp, .. } => {
                                if let Some(room) = &current_room {
                                    let chat_data = messages::ChatMessageData {
                                        from_id: peer_id.clone(),
                                        nickname: nickname.clone(),
                                        text: text.clone(),
                                        timestamp,
                                    };

                                    // Save to room history (max 50 messages)
                                    {
                                        let mut history_lock = chat_histories.lock().await;
                                        let room_history = history_lock.entry(room.clone()).or_insert_with(Vec::new);
                                        room_history.push(chat_data.clone());
                                        if room_history.len() > 50 {
                                            room_history.remove(0);
                                        }
                                    }

                                    let chat_broadcast = messages::SignalMessage::Chat {
                                        from_id: Some(peer_id.clone()),
                                        nickname,
                                        text,
                                        timestamp,
                                    };
                                    Self::broadcast_msg(&rooms, room, &chat_broadcast).await;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Some(broadcast_msg) = async {
                    if let Some(rx) = &mut rx {
                        rx.recv().await.ok()
                    } else {
                        std::future::pending().await
                    }
                } => {
                    writer.send(Message::Text(broadcast_msg.into())).await?;
                }
                else => break,
            }
        }

        if !peer_id.is_empty() {
            if let Some(room) = &current_room {
                let rooms_lock = rooms.lock().await;
                if let Some(tx) = rooms_lock.get(room) {
                    let left_msg = messages::SignalMessage::PeerLeft {
                        peer_id: peer_id.clone(),
                    };
                    let _ = tx.send(serde_json::to_string(&left_msg)?);
                }
            }
            peers.lock().await.remove(&peer_id);
        }

        Ok(())
    }

    async fn get_room_peers(
        peers: &Arc<Mutex<HashMap<String, String>>>,
        exclude_peer: &str,
    ) -> Vec<messages::PeerInfo> {
        let peers_lock = peers.lock().await;
        peers_lock
            .iter()
            .filter(|(id, _)| id.as_str() != exclude_peer)
            .map(|(id, nickname)| messages::PeerInfo {
                id: id.clone(),
                nickname: nickname.clone(),
            })
            .collect()
    }

    async fn broadcast_msg(
        rooms: &Arc<Mutex<RoomBroadcasts>>,
        room: &str,
        msg: &messages::SignalMessage,
    ) {
        let rooms_lock = rooms.lock().await;
        if let Some(tx) = rooms_lock.get(room) {
            if let Ok(msg_str) = serde_json::to_string(msg) {
                let _ = tx.send(msg_str);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signaling::messages::{ChatMessageData, SignalMessage};

    #[test]
    fn test_signal_message_serialization() {
        let offer = SignalMessage::Offer {
            to: "peer_b".to_string(),
            from: Some("peer_a".to_string()),
            sdp: "v=0...".to_string(),
        };

        let json = serde_json::to_string(&offer).unwrap();
        assert!(json.contains("\"type\":\"offer\""));
        assert!(json.contains("\"to\":\"peer_b\""));
        assert!(json.contains("\"from\":\"peer_a\""));

        let deserialized: SignalMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(offer, deserialized);
    }

    #[tokio::test]
    async fn test_chat_history_recording() {
        let server = SignalingServer::new();
        let room = "TEST01".to_string();

        {
            let mut history_lock = server.chat_histories.lock().await;
            let room_history = history_lock.entry(room.clone()).or_insert_with(Vec::new);
            room_history.push(ChatMessageData {
                from_id: "user1".to_string(),
                nickname: "Alice".to_string(),
                text: "Hello room!".to_string(),
                timestamp: 1000,
            });
        }

        let history_lock = server.chat_histories.lock().await;
        let messages = history_lock.get(&room).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].nickname, "Alice");
        assert_eq!(messages[0].text, "Hello room!");
    }
}
