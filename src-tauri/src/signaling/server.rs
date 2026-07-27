use crate::signaling::messages;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, broadcast};
use tokio_tungstenite::tungstenite::Message;

type RoomBroadcasts = HashMap<String, broadcast::Sender<String>>;

pub struct SignalingServer {
    rooms: Arc<Mutex<RoomBroadcasts>>,
    peers: Arc<Mutex<HashMap<String, String>>>,
}

impl SignalingServer {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            peers: Arc::new(Mutex::new(HashMap::new())),
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

            tokio::spawn(async move {
                if let Err(e) = Self::handle_connection(stream, rooms, peers).await {
                    eprintln!("[Signaling] Connection error: {}", e);
                }
            });
        }
    }

    async fn handle_connection(
        stream: TcpStream,
        rooms: Arc<Mutex<RoomBroadcasts>>,
        peers: Arc<Mutex<HashMap<String, String>>>,
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

                                let rooms_lock = rooms.lock().await;
                                let tx = rooms_lock.get(&room).cloned().unwrap_or_else(|| {
                                    let (tx, _) = broadcast::channel::<String>(100);
                                    tx
                                });
                                drop(rooms_lock);

                                let mut rooms_lock = rooms.lock().await;
                                rooms_lock.entry(room.clone()).or_insert_with(|| {
                                    let (tx, _) = broadcast::channel::<String>(100);
                                    tx
                                });
                                rx = Some(tx.subscribe());
                                drop(rooms_lock);

                                current_room = Some(room.clone());

                                let peers_list = Self::get_room_peers(&peers, &peer_id).await;

                                let peers_msg = messages::SignalMessage::Peers { peers: peers_list };
                                writer.send(Message::Text(serde_json::to_string(&peers_msg)?.into())).await?;

                                let join_msg = messages::SignalMessage::PeerJoined {
                                    peer: messages::PeerInfo {
                                        id: peer_id.clone(),
                                        nickname,
                                    },
                                };
                                Self::broadcast_msg(&rooms, &room, &join_msg).await;
                            }
                            messages::SignalMessage::Offer { to: _, sdp } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Offer {
                                        to: peer_id.clone(),
                                        sdp,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
                                }
                            }
                            messages::SignalMessage::Answer { to: _, sdp } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Answer {
                                        to: peer_id.clone(),
                                        sdp,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
                                }
                            }
                            messages::SignalMessage::Ice { to: _, candidate } => {
                                if let Some(room) = &current_room {
                                    let fwd = messages::SignalMessage::Ice {
                                        to: peer_id.clone(),
                                        candidate,
                                    };
                                    Self::broadcast_msg(&rooms, room, &fwd).await;
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
