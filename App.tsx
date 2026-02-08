import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SignalMessage, Stroke, Point } from './types';
import { DrawingBoard } from './components/DrawingBoard';
import LZString from 'lz-string';
import { Trash2, ShieldCheck, ArrowLeft, Copy, Check, Bell, LogOut, Link2, Download, Upload, Lock, Wifi, WifiOff, RefreshCw } from 'lucide-react';

// MQTT Client from global script
declare const mqtt: any;

// Public Broker for signaling
const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

type ViewState = 'HOME' | 'HOST_LOBBY' | 'JOIN_LOBBY' | 'MANUAL_HOST' | 'MANUAL_JOIN' | 'GAME';
type Role = 'HOST' | 'JOINER';
type Mode = 'CLOUD' | 'MANUAL';

interface SessionData {
  mode: Mode;
  role: Role;
  code: string; // The short code or manual offer
  timestamp: number;
}

export default function App() {
  // --- State ---
  const [view, setView] = useState<ViewState>('HOME');
  const [status, setStatus] = useState<string>(''); 
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // Signaling State
  const [shortCode, setShortCode] = useState<string>('');
  const [inputCode, setInputCode] = useState<string>('');
  
  // Manual State
  const [localOffer, setLocalOffer] = useState<string>('');
  const [remoteAnswer, setRemoteAnswer] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Game State
  const [flash, setFlash] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // --- Refs ---
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mqttClientRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // --- Session Management ---

  const saveSession = (mode: Mode, role: Role, code: string) => {
    const session: SessionData = { mode, role, code, timestamp: Date.now() };
    localStorage.setItem('chkobba_session', JSON.stringify(session));
  };

  const clearSession = () => {
    localStorage.removeItem('chkobba_session');
    // Also clear manual state backup
    localStorage.removeItem('chkobba_manual_state');
  };

  // Restore Session on Mount
  useEffect(() => {
    const saved = localStorage.getItem('chkobba_session');
    if (saved) {
      try {
        const session: SessionData = JSON.parse(saved);
        // Only restore if less than 2 hours old to prevent stale broken states
        if (Date.now() - session.timestamp < 2 * 60 * 60 * 1000) {
          console.log("Restoring session:", session);
          
          if (session.mode === 'CLOUD') {
            setShortCode(session.code);
            setInputCode(session.code);
            setIsReconnecting(true);
            // Wait a tiny bit for UI to settle then connect
            setTimeout(() => {
              if (session.role === 'HOST') {
                connectCloudHost(session.code);
              } else {
                connectCloudJoiner(session.code);
              }
            }, 100);
          } else if (session.mode === 'MANUAL') {
            // Restore manual view but cannot auto-reconnect WebRTC
            const manualState = localStorage.getItem('chkobba_manual_state');
            if (manualState) {
               const parsed = JSON.parse(manualState);
               setLocalOffer(parsed.localOffer || '');
               setRemoteAnswer(parsed.remoteAnswer || '');
               if (session.role === 'HOST') setView('MANUAL_HOST');
               else setView('MANUAL_JOIN');
            }
          }
        } else {
          clearSession();
        }
      } catch (e) {
        clearSession();
      }
    }

    return () => {
      pcRef.current?.close();
      mqttClientRef.current?.end();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  // Save Manual State when typing (so refresh doesn't lose the huge text)
  useEffect(() => {
    if (view === 'MANUAL_HOST' || view === 'MANUAL_JOIN') {
      localStorage.setItem('chkobba_manual_state', JSON.stringify({ localOffer, remoteAnswer }));
    }
  }, [localOffer, remoteAnswer, view]);

  // --- Wake Lock & Heartbeat & Visibility ---
  useEffect(() => {
    let wakeLock: any = null;
    let heartbeatInterval: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          setWakeLockActive(true);
        }
      } catch (err) {
        setWakeLockActive(false);
      }
    };

    if (view === 'GAME') {
      requestWakeLock();
      heartbeatInterval = setInterval(() => {
        if (dataChannelRef.current?.readyState === 'open') {
          try {
            dataChannelRef.current.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } catch (e) {}
        }
      }, 3000);
    }

    // Auto-reconnect on visibility change (User comes back to app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        // If we are in GAME view but disconnected, try to reconnect
        if (view === 'GAME' && pcRef.current?.connectionState !== 'connected') {
           const saved = localStorage.getItem('chkobba_session');
           if (saved) {
             const session: SessionData = JSON.parse(saved);
             if (session.mode === 'CLOUD') {
               console.log("App visible but disconnected. Reconnecting...");
               setIsReconnecting(true);
               if (session.role === 'HOST') connectCloudHost(session.code);
               else connectCloudJoiner(session.code);
             }
           }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLock) wakeLock.release();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      setWakeLockActive(false);
    };
  }, [view]);

  // --- Actions ---

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearBoard = () => {
    setStrokes([]);
    sendSync('CLEAR_BOARD', {});
  };

  const triggerPing = () => {
    if (navigator.vibrate) navigator.vibrate(50);
    sendSync('PING', {});
  };

  const handleIncomingPing = () => {
    setFlash(true);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setTimeout(() => setFlash(false), 500);
  };

  const exitGame = () => {
    if (confirm("Disconnect and exit?")) {
      clearSession();
      window.location.reload(); 
    }
  };

  // --- WebRTC Setup ---

  const initPC = () => {
    if (pcRef.current) pcRef.current.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    
    pc.onconnectionstatechange = () => {
      console.log("Connection State:", pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('Connected');
        setView('GAME');
        setIsReconnecting(false);
        mqttClientRef.current?.end(); // Close signaling once P2P connects
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('Disconnected. Trying to reconnect...');
        // Optional: Trigger auto-reconnect logic here if needed
      }
    };

    pc.oniceconnectionstatechange = () => {
       console.log("ICE State:", pc.iceConnectionState);
       if (pc.iceConnectionState === 'disconnected') {
         // This often happens when screen goes off
         setStatus('Connection paused...');
       }
    }

    pc.ondatachannel = (e) => {
      setupDataChannel(e.channel);
    };

    pcRef.current = pc;
    return pc;
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.onopen = () => {
      setStatus('Connected');
      setView('GAME');
    };
    channel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'SYNC_STROKE' && data.stroke) {
          setStrokes(prev => [...prev, { ...data.stroke, isRemote: true, color: '#22c55e' }]);
        } else if (data.type === 'CLEAR_BOARD') {
          setStrokes([]);
        } else if (data.type === 'PING') {
          handleIncomingPing();
        }
      } catch (err) {}
    };
  };

  const sendSync = (type: any, payload: any) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({ type, ...payload }));
    }
  };

  const handleStrokeComplete = (points: Point[]) => {
    const newStroke: Stroke = {
      id: Date.now().toString(),
      points,
      color: '#3b82f6',
      isRemote: false
    };
    setStrokes(prev => [...prev, newStroke]);
    sendSync('SYNC_STROKE', { stroke: newStroke });
  };

  // --- CLOUD MODE (Short Codes) ---

  const startCloudHost = () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setShortCode(code);
    saveSession('CLOUD', 'HOST', code);
    connectCloudHost(code);
  };

  // Separated logic for reusability (Reconnection)
  const connectCloudHost = (code: string) => {
    setView('HOST_LOBBY'); // Temporary view until connected
    setStatus(isReconnecting ? 'Reconnecting...' : 'Initializing Host...');

    const pc = initPC();
    const channel = pc.createDataChannel("chkobba");
    setupDataChannel(channel);

    // Ensure we kill old mqtt client
    if (mqttClientRef.current) mqttClientRef.current.end();

    const client = mqtt.connect(BROKER_URL);
    mqttClientRef.current = client;

    client.on('connect', async () => {
      setStatus('Waiting for player...');
      client.subscribe(`chkobba/${code}/join`);
      client.subscribe(`chkobba/${code}/answer`);
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // If we are reconnecting (refresh), the other player might be waiting or also refreshing.
      // Publish "I_AM_HERE" to prompt them to re-join if they are lost
      if (isReconnecting) {
         client.publish(`chkobba/${code}/restart`, 'host_back');
      }
    });

    client.on('message', async (topic: string, message: Buffer) => {
      const msg = message.toString();
      
      if (topic.endsWith('/join') || topic.endsWith('/restart')) {
        // Player 2 is here or requesting restart, send Offer
        console.log("Peer detected, sending offer");
        if (pc.signalingState !== 'stable') {
             // Reset if we are in a weird state
             // But usually we just send the local description we already made
        }
        const offer = JSON.stringify(pc.localDescription);
        client.publish(`chkobba/${code}/offer`, offer);
        setStatus('Sending Offer...');
      } 
      
      if (topic.endsWith('/answer')) {
        // Received Answer
        console.log("Received Answer");
        try {
           const answerDesc = JSON.parse(msg);
           if (pc.signalingState === 'have-local-offer') {
               await pc.setRemoteDescription(answerDesc);
               setStatus('Connecting P2P...');
           }
        } catch(e) { console.error(e); }
      }
    });
  };

  const joinCloudGame = () => {
    if (inputCode.length !== 4) return;
    saveSession('CLOUD', 'JOINER', inputCode);
    connectCloudJoiner(inputCode);
  };

  const connectCloudJoiner = (code: string) => {
    if (view !== 'GAME') setView('JOIN_LOBBY');
    setStatus(isReconnecting ? 'Reconnecting...' : 'Connecting to Cloud...');
    
    const pc = initPC();
    
    if (mqttClientRef.current) mqttClientRef.current.end();
    const client = mqtt.connect(BROKER_URL);
    mqttClientRef.current = client;

    client.on('connect', () => {
      setStatus('Looking for room...');
      client.subscribe(`chkobba/${code}/offer`);
      client.subscribe(`chkobba/${code}/restart`);
      
      // Send JOIN signal
      client.publish(`chkobba/${code}/join`, 'hello');
    });

    client.on('message', async (topic: string, message: Buffer) => {
      const msg = message.toString();
      
      // If Host restarts, they send 'restart', we should send 'join' again
      if (topic.endsWith('/restart')) {
          client.publish(`chkobba/${code}/join`, 'hello_again');
          return;
      }

      if (topic.endsWith('/offer')) {
        console.log("Received Offer");
        setStatus('Found Host. Processing...');
        const offerDesc = JSON.parse(msg);
        
        // Handle race conditions on refresh
        if (pc.signalingState !== 'stable') {
             // If we already set remote, we might need to reset or ignore.
             // For simplicity, we just proceed as initPC created a fresh one.
        }

        await pc.setRemoteDescription(offerDesc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        // Wait for ICE gathering to ensure robust connection (especially mobile)
        setTimeout(() => {
           const answerString = JSON.stringify(pc.localDescription);
           client.publish(`chkobba/${code}/answer`, answerString);
           setStatus('Connecting P2P...');
        }, 1000);
      }
    });
  };

  // --- MANUAL MODE (Offline Long Codes) ---

  const startManualHost = async () => {
    setView('MANUAL_HOST');
    saveSession('MANUAL', 'HOST', 'manual');
    setStatus('Generating Code...');
    const pc = initPC();
    const channel = pc.createDataChannel("chkobba");
    setupDataChannel(channel);

    pc.onicecandidate = (e) => {
      if (e.candidate === null) {
        const sdp = JSON.stringify(pc.localDescription);
        const compressed = LZString.compressToBase64(sdp);
        setLocalOffer(compressed);
        setStatus('Ready');
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  };

  const handleManualHostConnect = async () => {
    try {
      if (!pcRef.current || !remoteAnswer) return;
      const desc = JSON.parse(LZString.decompressFromBase64(remoteAnswer));
      await pcRef.current.setRemoteDescription(desc);
      setStatus('Connecting...');
    } catch (e) {
      setErrorMsg("Invalid Answer Code");
    }
  };

  const startManualJoin = () => {
    setView('MANUAL_JOIN');
    saveSession('MANUAL', 'JOINER', 'manual');
    setRemoteAnswer(''); // Used as Offer input here
  };

  const handleManualJoinGenerate = async () => {
    try {
      const pc = initPC();
      const offerDesc = JSON.parse(LZString.decompressFromBase64(remoteAnswer));
      await pc.setRemoteDescription(offerDesc);
      
      pc.onicecandidate = (e) => {
        if (e.candidate === null) {
           const sdp = JSON.stringify(pc.localDescription);
           const compressed = LZString.compressToBase64(sdp);
           setLocalOffer(compressed); // Display this as the Answer
           setStatus('Reply Generated');
        }
      };
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch (e) {
      setErrorMsg("Invalid Host Code");
    }
  };

  // --- RENDER ---

  const renderHome = () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="text-center space-y-2">
         <div className="flex justify-center"><ShieldCheck size={64} className="text-blue-500" /></div>
         <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">Chkobba Signal</h1>
         <p className="text-slate-400 text-sm">Secure Card Signaling</p>
      </div>

      <div className="w-full max-w-sm space-y-6">
        {/* Short Code Section */}
        <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <Wifi size={18}/> <span className="text-sm font-bold uppercase tracking-wider">Online Mode (Easy)</span>
          </div>
          <button onClick={startCloudHost} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex items-center justify-center gap-2">
             Start New Game (Host)
          </button>
          
          <div className="flex gap-2">
            <input 
               type="tel" 
               maxLength={4}
               placeholder="0000"
               value={inputCode}
               onChange={e => setInputCode(e.target.value)}
               className="w-24 text-center bg-slate-950 border border-slate-700 rounded-xl text-xl font-mono tracking-widest focus:border-blue-500 outline-none"
            />
            <button onClick={joinCloudGame} disabled={inputCode.length !== 4} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-xl font-bold">
               Join Game
            </button>
          </div>
        </div>

        {/* Offline Fallback */}
        <div className="pt-4 border-t border-slate-800">
           <p className="text-center text-xs text-slate-500 mb-4 flex items-center justify-center gap-1"><WifiOff size={12}/> No Internet? Use Offline Mode</p>
           <div className="grid grid-cols-2 gap-3">
             <button onClick={startManualHost} className="py-2 text-sm bg-slate-900 border border-slate-700 hover:bg-slate-800 rounded-lg text-slate-400">
               Manual Host
             </button>
             <button onClick={startManualJoin} className="py-2 text-sm bg-slate-900 border border-slate-700 hover:bg-slate-800 rounded-lg text-slate-400">
               Manual Join
             </button>
           </div>
        </div>
      </div>
    </div>
  );

  // --- Views ---

  if (view === 'HOST_LOBBY' || view === 'JOIN_LOBBY') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center space-y-8">
         <button onClick={() => { clearSession(); window.location.reload(); }} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
         <div>
           {view === 'HOST_LOBBY' ? (
             <>
               <h2 className="text-slate-400 text-sm uppercase tracking-widest mb-2">Your Room Code</h2>
               <div className="text-6xl font-mono font-bold text-white tracking-widest">{shortCode}</div>
               <div className="text-xs text-slate-600 max-w-xs mt-4">Tell your partner to enter this number</div>
             </>
           ) : (
             <h2 className="text-xl font-bold text-white">Joining Room {inputCode}...</h2>
           )}
         </div>
         <div className="flex items-center gap-2 text-blue-400 text-sm">
            <RefreshCw className="animate-spin" size={16} /> 
            <span>{status}</span>
         </div>
         {isReconnecting && <p className="text-xs text-yellow-500">Restoring previous session...</p>}
      </div>
    );
  }

  // --- Manual/Offline Views ---

  if (view === 'MANUAL_HOST') {
    return (
      <div className="min-h-screen bg-slate-950 p-6 flex flex-col items-center pt-12 space-y-6">
         <button onClick={() => { clearSession(); setView('HOME'); }} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
         <h2 className="text-xl font-bold text-blue-400">1. Share This Code</h2>
         
         <div className="w-full max-w-sm">
            <textarea readOnly value={localOffer || "Generating..."} className="w-full h-24 bg-slate-900 p-2 text-[10px] text-slate-500 rounded border border-slate-800 mb-2 resize-none" />
            <button onClick={() => copyToClipboard(localOffer)} className="w-full py-3 bg-slate-800 rounded-xl font-bold flex items-center justify-center gap-2">
               {copied ? <Check size={16} className="text-green-500"/> : <Copy size={16}/>} Copy Code
            </button>
         </div>

         <div className="w-full max-w-sm pt-6 border-t border-slate-800">
            <h2 className="text-xl font-bold text-green-400 mb-4">2. Enter Reply Code</h2>
            <textarea 
               value={remoteAnswer} 
               onChange={e => setRemoteAnswer(e.target.value)}
               placeholder="Paste partner's code here..."
               className="w-full h-24 bg-slate-900 p-2 text-[10px] text-slate-200 rounded border border-slate-700 mb-2 resize-none focus:border-blue-500 outline-none" 
            />
            <button onClick={handleManualHostConnect} disabled={!remoteAnswer} className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-xl font-bold">
               Connect
            </button>
            {errorMsg && <p className="text-red-500 text-xs mt-2 text-center">{errorMsg}</p>}
         </div>
      </div>
    );
  }

  if (view === 'MANUAL_JOIN') {
    return (
      <div className="min-h-screen bg-slate-950 p-6 flex flex-col items-center pt-12 space-y-6">
         <button onClick={() => { clearSession(); setView('HOME'); }} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
         
         {!localOffer ? (
           <div className="w-full max-w-sm space-y-4">
              <h2 className="text-xl font-bold text-blue-400">1. Paste Host Code</h2>
              <textarea 
                 value={remoteAnswer} 
                 onChange={e => setRemoteAnswer(e.target.value)}
                 placeholder="Paste code from Player 1..."
                 className="w-full h-32 bg-slate-900 p-2 text-[10px] text-slate-200 rounded border border-slate-700 resize-none focus:border-blue-500 outline-none" 
              />
              <button onClick={handleManualJoinGenerate} disabled={!remoteAnswer} className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold">
                 Generate Reply
              </button>
              {errorMsg && <p className="text-red-500 text-xs mt-2 text-center">{errorMsg}</p>}
           </div>
         ) : (
           <div className="w-full max-w-sm space-y-4">
              <h2 className="text-xl font-bold text-green-400">2. Share This Reply</h2>
              <textarea readOnly value={localOffer} className="w-full h-32 bg-slate-900 p-2 text-[10px] text-slate-500 rounded border border-slate-800 resize-none" />
              <button onClick={() => copyToClipboard(localOffer)} className="w-full py-3 bg-slate-800 rounded-xl font-bold flex items-center justify-center gap-2">
                 {copied ? <Check size={16} className="text-green-500"/> : <Copy size={16}/>} Copy Reply Code
              </button>
              <p className="text-center text-xs text-slate-500">Send this back to Player 1</p>
           </div>
         )}
      </div>
    );
  }

  if (view === 'HOME') return renderHome();

  // --- GAME VIEW ---
  return (
    <div className={`min-h-screen flex flex-col text-slate-200 overflow-hidden fixed inset-0 transition-colors duration-300 ${flash ? 'bg-blue-900/50' : 'bg-slate-950'}`}>
      <header className="absolute top-0 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-3 py-2 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-green-900/20`}>
               <Link2 size={16} className="text-green-500"/>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] text-slate-500 font-mono">CHKOBBA SIGNAL</span>
              <div className="flex items-center gap-1">
                 {status.includes('Connected') ? (
                    <span className="text-xs font-bold tracking-wider text-green-400">CONNECTED</span>
                 ) : (
                    <span className="text-xs font-bold tracking-wider text-yellow-500 animate-pulse">RECONNECTING...</span>
                 )}
                 {wakeLockActive && <div title="Screen Wake Lock Active"><Lock size={10} className="text-blue-400" /></div>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={triggerPing} className="p-2 text-yellow-500 bg-yellow-900/20 hover:bg-yellow-900/40 rounded-full transition-colors flex items-center gap-2 border border-yellow-900/30">
              <Bell size={20} className={flash ? 'animate-bounce' : ''} />
            </button>
            <button onClick={clearBoard} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors">
              <Trash2 size={20} />
            </button>
            <button onClick={exitGame} className="text-[10px] bg-red-900/20 text-red-400 hover:bg-red-900/40 px-3 py-1.5 rounded border border-red-900/30 transition-colors flex items-center gap-1">
              <LogOut size={12} /> END
            </button>
          </div>
        </div>
      </header>

      <main className="w-full h-full pt-14 pb-0">
         <DrawingBoard strokes={strokes} onStrokeComplete={handleStrokeComplete} color="#3b82f6" />
      </main>
    </div>
  );
}