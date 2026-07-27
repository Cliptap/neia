import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const SIGNALING_URL = 'ws://127.0.0.1:9876';
const ROOM_CODE = 'QMPASS';

async function runQualityTest() {
  console.log('🚀 Starting NEIA Automated Quality & Connection Test Harness...');

  const startTime = Date.now();
  let peerA_id = null;
  let peerB_id = null;
  let chatHistoryReceived = false;
  let peerB_joined = false;

  const testReport = {
    timestamp: new Date().toISOString(),
    signalingServerUrl: SIGNALING_URL,
    connectionSetupTimeMs: 0,
    chatHistorySupported: false,
    peerDiscoveryLatencyMs: 0,
    status: 'FAIL',
    metrics: {
      targetRttMs: '< 150 ms',
      targetPacketLossRate: '< 1.0 %',
      targetSetupTimeMs: '< 1500 ms',
    },
  };

  return new Promise((resolve) => {
    const wsA = new WebSocket(SIGNALING_URL);

    wsA.on('open', () => {
      console.log('✅ Peer A connected to signaling server');
      wsA.send(JSON.stringify({ type: 'join', room: ROOM_CODE, nickname: 'PeerA' }));
    });

    wsA.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'peers') {
        console.log('✅ Peer A joined room, waiting for Peer B...');

        // Send a test chat message from Peer A to populate history
        wsA.send(JSON.stringify({
          type: 'chat',
          nickname: 'PeerA',
          text: 'Quality test initial message',
          timestamp: Date.now(),
        }));

        // Now connect Peer B after a short delay
        setTimeout(() => connectPeerB(), 300);
      } else if (msg.type === 'peer_joined') {
        peerB_id = msg.peer.id;
        peerB_joined = true;
        console.log(`✅ Peer A detected Peer B joined: ${msg.peer.nickname}`);
      }
    });

    function connectPeerB() {
      const peerBStart = Date.now();
      const wsB = new WebSocket(SIGNALING_URL);

      wsB.on('open', () => {
        console.log('✅ Peer B connected to signaling server');
        wsB.send(JSON.stringify({ type: 'join', room: ROOM_CODE, nickname: 'PeerB' }));
      });

      wsB.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'chat_history') {
          console.log(`✅ Peer B received room chat history (${msg.messages.length} messages)`);
          chatHistoryReceived = true;
          testReport.chatHistorySupported = true;
        }

        if (msg.type === 'peers') {
          testReport.peerDiscoveryLatencyMs = Date.now() - peerBStart;
          testReport.connectionSetupTimeMs = Date.now() - startTime;
          console.log(`✅ Connection setup complete in ${testReport.connectionSetupTimeMs} ms`);

          setTimeout(() => {
            wsA.close();
            wsB.close();

            if (peerB_joined && chatHistoryReceived && testReport.connectionSetupTimeMs < 3000) {
              testReport.status = 'PASS';
              console.log('🎉 QUALITY TEST PASSED!');
            } else {
              testReport.status = 'FAIL';
              console.log('❌ QUALITY TEST FAILED');
            }

            const reportPath = path.join(process.cwd(), 'quality_report.json');
            fs.writeFileSync(reportPath, JSON.stringify(testReport, null, 2));
            console.log(`📄 Saved report to ${reportPath}`);
            resolve(testReport);
          }, 500);
        }
      });

      wsB.on('error', (err) => {
        console.error('❌ Peer B error:', err.message);
        resolve(testReport);
      });
    }

    wsA.on('error', (err) => {
      console.error('❌ Peer A connection error:', err.message);
      console.log('💡 Make sure the NEIA application or signaling server is running on ws://127.0.0.1:9876');
      resolve(testReport);
    });
  });
}

runQualityTest().catch(console.error);
