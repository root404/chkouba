import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { generateDeck } from './constants';
import { Card } from './Card';
import { SignalMessage } from './types';
import { Users, Wifi, Trash2, ShieldCheck, Info, RefreshCw, AlertCircle, ArrowLeft, Copy, Check } from 'lucide-react';

// Define PeerJS types broadly since we are using CDN
declare global {
  interface Window {
    Peer: any;
  }
}

// Stronger STUN server list to penetrate Mobile Networks (NAT/Firewalls)
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { url: 'stun:stun.l.google.com:19302' },
      { url: 'stun:stun1.l.google.com:19302' },
      { url: 'stun:stun2.l.google.com:19302' },
      { url: 'stun:stun3.l.google.com:19302' },
      { url: 'stun:stun4.l.google.com:19302' },
      { url: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

type ViewState = 'HOME' | 'JOIN_INPUT' | 'HOST_LOBBY' | 'GAME';

export default function App() {
  // --- State ---
  const [view, setView] = useState<ViewState>('HOME');
  const [roomCode, setRoomCode] = useState<string>('');
  const [status, setStatus] = useState<string>(''); 
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isHost, setIsHost] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  
  // Game State
  const [mySelection, setMySelection] = useState<Set<string>>(new Set());
  const [partnerSelection, setPartnerSelection] = useState<Set<string>>(new Set());
  const [crossedCards, setCrossedCards] = useState<Set<string>>(new Set());
  const [circledCards, setCircledCards] = useState<Set<string>>(new Set());
  const [shakingCardId, setShakingCardId] = useState<string | null>(null);

  // --- Refs ---
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const deck = useMemo(() => generateDeck(), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  // --- Actions ---

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetGame = () => {
    setMySelection(new Set());
    setCrossedCards(new Set());
    setCircledCards(new Set());
    setPartnerSelection(new Set()); // Optional: usually we don't clear partner's view of us, but this is a hard reset
    sendSync('RESET', {});
  };

  const leaveRoom = () => {
    peerRef.current?.destroy();
    connRef.current = null;
    setView('HOME');
    setRoomCode('');
    setErrorMsg('');
    setStatus('');
    setMySelection(new Set());
    setPartnerSelection(new Set());
    setCrossedCards(new Set());
    setCircledCards(new Set());
  };

  // --- Network Logic ---

  const startHost = () => {
    const Peer = window.Peer;
    if (!Peer) { setErrorMsg("PeerJS not loaded. Check internet."); return; }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setRoomCode(code);
    setIsHost(true);
    setView('HOST_LOBBY');
    setErrorMsg('');
    setStatus('Initializing Room...');

    // Clean up old peer if any
    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(`chkobba-v3-${code}`, PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      setStatus('Waiting for partner to join...');
    });

    peer.on('connection', (conn: any) => {
      connRef.current = conn;
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
      setErrorMsg(`Host Error: ${err.type}`);
      setStatus('Connection Failed');
    });
  };

  const joinGame = () => {
    if (roomCode.length !== 4) {
        setErrorMsg("Code must be 4 digits");
        return;
    }

    const Peer = window.Peer;
    if (!Peer) { setErrorMsg("PeerJS not loaded."); return; }

    setIsHost(false);
    setErrorMsg('');
    setStatus('Connecting to Host...');
    
    // Clean up old
    if (peerRef.current) peerRef.current.destroy();

    // Guest gets random ID
    const peer = new Peer(null, PEER_CONFIG);
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      const conn = peer.connect(`chkobba-v3-${roomCode}`, { reliable: true });
      connRef.current = conn;
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
       setErrorMsg(`Join Error: ${err.type}. Check Code?`);
       setStatus('Failed');
    });
  };

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setStatus('Connected');
      setView('GAME');
      // Send initial hello / sync
      sendSync('RESET', {});
    });

    conn.on('data', (data: SignalMessage) => {
      handleData(data);
    });

    conn.on('close', () => {
      alert("Partner Disconnected");
      leaveRoom();
    });

    conn.on('error', (err: any) => {
        console.error("Conn error", err);
    });
  };

  const sendSync = (type: SignalMessage['type'], payload: Partial<SignalMessage>) => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type, ...payload });
    }
  };

  const handleData = (data: SignalMessage) => {
     if (data.type === 'SYNC_SELECTION' && data.selection) {
       setPartnerSelection(new Set(data.selection));
     } else if (data.type === 'SYNC_CROSSED' && data.crossed) {
       setCrossedCards(new Set(data.crossed));
     } else if (data.type === 'SYNC_CIRCLE' && data.circled) {
       setCircledCards(new Set(data.circled));
     } else if (data.type === 'SIGNAL_SHAKE' && data.cardId) {
       triggerShake(data.cardId);
     } else if (data.type === 'RESET') {
       // Reset request from partner implies we should clear our view of them? 
       // Or usually, it means "I am resetting my board".
       // Let's assume global reset for simplicity in coordination.
       setPartnerSelection(new Set());
       setCrossedCards(new Set());
       setCircledCards(new Set());
       // Optional: Reset mine too?
       setMySelection(new Set());
     }
  };

  // --- Interaction Handlers ---

  const triggerShake = (id: string) => {
    setShakingCardId(id);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
    setTimeout(() => setShakingCardId(null), 1000);
  };

  const toggleSelection = useCallback((id: string) => {
    setMySelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 3) { // Limit max selection if desired, or keep logic simple
            // Keep logic simple: toggle
            // But usually 3 cards in hand. Let's strictly limit to 3 for usability.
            const it = next.values();
            const first = it.next().value;
            if (next.size >= 3 && first) next.delete(first);
        }
        next.add(id);
      }
      sendSync('SYNC_SELECTION', { selection: Array.from(next) });
      return next;
    });
  }, []);

  const toggleCross = useCallback((id: string) => {
    // REMOVED CHECK: if (!partnerSelection.has(id)) return;
    setCrossedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      sendSync('SYNC_CROSSED', { crossed: Array.from(next) });
      return next;
    });
  }, []);

  const toggleCircle = useCallback((id: string) => {
     // Usually circle own cards or partner cards? 
     // Requirement: "When I select cards... blue on partner screen". 
     // Crossed/Circle is extra UI for coordination. Let's allow circling anything.
    setCircledCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      sendSync('SYNC_CIRCLE', { circled: Array.from(next) });
      return next;
    });
  }, []);

  const sendSignal = useCallback((id: string) => {
    sendSync('SIGNAL_SHAKE', { cardId: id });
  }, []);


  // --- Render Functions ---

  const renderHome = () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="text-center space-y-2">
         <div className="flex justify-center"><ShieldCheck size={64} className="text-blue-500" /></div>
         <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">Chkobba Signal</h1>
         <p className="text-slate-400">Secure Partner Coordination</p>
      </div>

      <div className="w-full max-w-xs space-y-4">
        <button onClick={startHost} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-3">
          <Users size={24}/> Create Room
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
          <div className="relative flex justify-center text-sm"><span className="px-2 bg-slate-950 text-slate-500">OR</span></div>
        </div>
        <button onClick={() => { setView('JOIN_INPUT'); setRoomCode(''); setErrorMsg(''); }} className="w-full py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3">
          <Wifi size={24}/> Join Room
        </button>
      </div>
    </div>
  );

  const renderHostLobby = () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-2xl w-full max-w-sm space-y-6">
        <div>
          <h2 className="text-slate-400 text-sm font-bold tracking-widest uppercase mb-2">Room Code</h2>
          <div onClick={copyCode} className="bg-slate-950 border border-blue-500/30 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-blue-500 transition-colors group">
             <span className="text-4xl font-mono font-bold tracking-[0.2em] text-white">{roomCode}</span>
             {copied ? <Check className="text-green-500"/> : <Copy className="text-slate-600 group-hover:text-blue-400"/>}
          </div>
          <p className="text-xs text-slate-500 mt-2">Share this code with your partner</p>
        </div>
        
        <div className="flex flex-col items-center gap-3 py-4">
           <RefreshCw className="animate-spin text-blue-500" size={32}/>
           <p className="text-slate-300 animate-pulse">{status}</p>
        </div>

        <button onClick={leaveRoom} className="text-slate-500 hover:text-white underline text-sm">Cancel</button>
      </div>
      {errorMsg && <div className="mt-4 bg-red-900/50 text-red-200 px-4 py-2 rounded-lg text-sm border border-red-900">{errorMsg}</div>}
    </div>
  );

  const renderJoinInput = () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
       <div className="w-full max-w-sm space-y-6">
         <button onClick={() => setView('HOME')} className="flex items-center gap-2 text-slate-500 hover:text-white mb-4"><ArrowLeft size={16}/> Back</button>
         
         <div className="space-y-2">
           <h2 className="text-2xl font-bold">Enter Room Code</h2>
           <p className="text-slate-400 text-sm">Ask your partner for the 4-digit code</p>
         </div>

         <input 
           type="tel" 
           value={roomCode}
           onChange={(e) => setRoomCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
           placeholder="0000"
           className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl p-4 text-center text-4xl font-mono tracking-[0.5em] outline-none transition-all"
           autoFocus
         />

         <button 
           onClick={joinGame}
           disabled={roomCode.length !== 4}
           className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${roomCode.length === 4 ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
         >
           {status === 'Connecting to Host...' ? 'Connecting...' : 'Connect'}
         </button>

         {errorMsg && <div className="bg-red-900/50 text-red-200 px-4 py-2 rounded-lg text-sm border border-red-900 flex items-center gap-2 justify-center"><AlertCircle size={16}/> {errorMsg}</div>}
       </div>
    </div>
  );

  if (view === 'HOME') return renderHome();
  if (view === 'HOST_LOBBY') return renderHostLobby();
  if (view === 'JOIN_INPUT') return renderJoinInput();

  // --- GAME VIEW ---
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-3 py-2 sm:px-4 sm:py-3 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 sm:p-2 rounded-lg bg-green-900/20">
               <Wifi size={16} className="text-green-500 sm:w-[18px] sm:h-[18px]"/>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] sm:text-xs text-slate-500 font-mono">ROOM: {roomCode}</span>
              <span className="text-xs sm:text-sm font-bold tracking-wider">{isHost ? 'HOST' : 'GUEST'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex gap-4 text-xs font-medium">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div><span>ME</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div><span>PARTNER</span>
              </div>
            </div>

            <button onClick={resetGame} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors" title="Clear Board">
              <Trash2 size={18} />
            </button>
            <button onClick={leaveRoom} className="text-[10px] sm:text-xs bg-red-900/20 text-red-400 hover:bg-red-900/40 px-2 sm:px-3 py-1 rounded border border-red-900/30 transition-colors">
              EXIT
            </button>
          </div>
        </div>
      </header>

      {/* Grid Area */}
      <main className="flex-1 p-2 sm:p-4 overflow-y-auto">
        <div className="max-w-6xl mx-auto grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-1.5 sm:gap-3 pb-20">
          {deck.map((card) => (
            <Card
              key={card.id}
              card={card}
              isSelectedByMe={mySelection.has(card.id)}
              isSelectedByPartner={partnerSelection.has(card.id)}
              isCrossed={crossedCards.has(card.id)}
              isCircled={circledCards.has(card.id)}
              isShaking={shakingCardId === card.id}
              onToggleSelect={toggleSelection}
              onToggleCross={toggleCross}
              onToggleCircle={toggleCircle}
              onSignal={sendSignal}
            />
          ))}
        </div>
      </main>

      {/* Mobile Legend */}
      <div className="sm:hidden fixed bottom-0 w-full bg-slate-900/95 backdrop-blur border-t border-slate-800 p-2 flex justify-around text-[10px] font-bold z-50">
         <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
            <span>YOU</span>
         </div>
         <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
            <span>PARTNER</span>
         </div>
      </div>
    </div>
  );
}