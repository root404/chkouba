import React, { useState, useEffect, useRef } from 'react';
import { SignalMessage, Stroke, Point } from './types';
import { DrawingBoard } from './components/DrawingBoard';
import LZString from 'lz-string';
import { Users, Trash2, ShieldCheck, RefreshCw, AlertCircle, ArrowLeft, Copy, Check, Bell, LogOut, Link2, Download, Upload } from 'lucide-react';

// Using raw RTCPeerConnection for serverless/offline usage
const RTC_CONFIG = {
  iceServers: [] // No STUN servers needed for LAN/Offline
};

type ViewState = 'HOME' | 'CREATE_OFFER' | 'ENTER_OFFER' | 'SHOW_ANSWER' | 'ENTER_ANSWER' | 'GAME';

export default function App() {
  // --- State ---
  const [view, setView] = useState<ViewState>('HOME');
  const [status, setStatus] = useState<string>(''); 
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [localCode, setLocalCode] = useState<string>(''); // Code I generated
  const [remoteCodeInput, setRemoteCodeInput] = useState<string>(''); // Code I need to input
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);
  
  // Drawing State
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  // --- Refs ---
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      pcRef.current?.close();
    };
  }, []);

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
      window.location.reload(); // Hard reset for clean state
    }
  };

  // --- Serverless WebRTC Logic ---

  const initPC = () => {
    if (pcRef.current) pcRef.current.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    
    pc.onicecandidate = (e) => {
      // In serverless, we wait for ALL candidates (null) to generate one single string
      if (e.candidate === null) {
        // Gathering complete
        const sdp = JSON.stringify(pc.localDescription);
        const compressed = LZString.compressToBase64(sdp);
        setLocalCode(compressed);
        setStatus('Code Generated! Share it.');
      }
    };

    pc.ondatachannel = (e) => {
      setupDataChannel(e.channel);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setView('GAME');
        setStatus('Connected');
      } else if (pc.connectionState === 'disconnected') {
        setStatus('Disconnected');
      }
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
        handleData(data);
      } catch (err) {
        console.error("Parse error", err);
      }
    };
  };

  // --- Step 1: HOST creates Offer ---
  const startHost = async () => {
    setView('CREATE_OFFER');
    setStatus('Generating Host Code...');
    const pc = initPC();
    
    // Host creates the data channel
    const channel = pc.createDataChannel("chkobba");
    setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Wait for onicecandidate to setLocalCode
  };

  // --- Step 2: GUEST inputs Offer, creates Answer ---
  const startJoin = () => {
    setView('ENTER_OFFER');
    setStatus('Waiting for Host Code...');
    setRemoteCodeInput('');
  };

  const processOfferAndGenerateAnswer = async () => {
    try {
      setStatus('Processing...');
      const pc = initPC();
      const decompressed = LZString.decompressFromBase64(remoteCodeInput);
      if (!decompressed) throw new Error("Invalid Code");
      
      const offerDesc = JSON.parse(decompressed);
      await pc.setRemoteDescription(offerDesc);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      setView('SHOW_ANSWER');
      setStatus('Generating Reply Code...');
      // Wait for onicecandidate to setLocalCode (which will be the answer)
    } catch (e) {
      setErrorMsg("Invalid Host Code");
    }
  };

  // --- Step 3: HOST inputs Answer ---
  const processAnswer = async () => {
    try {
      if (!pcRef.current) return;
      const decompressed = LZString.decompressFromBase64(remoteCodeInput);
      if (!decompressed) throw new Error("Invalid Code");

      const answerDesc = JSON.parse(decompressed);
      await pcRef.current.setRemoteDescription(answerDesc);
      setStatus('Connecting...');
    } catch (e) {
      setErrorMsg("Invalid Reply Code");
    }
  };

  // --- Signaling ---

  const sendSync = (type: SignalMessage['type'], payload: Partial<SignalMessage>) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({ type, ...payload }));
    }
  };

  const handleData = (data: SignalMessage) => {
     if (data.type === 'SYNC_STROKE' && data.stroke) {
       const incoming: Stroke = { ...data.stroke, isRemote: true, color: '#22c55e' }; 
       setStrokes(prev => [...prev, incoming]);
     } else if (data.type === 'CLEAR_BOARD') {
       setStrokes([]);
     } else if (data.type === 'PING') {
       handleIncomingPing();
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

  // --- Render Helpers ---
  
  const CodeDisplay = ({ label, code, onNext }: { label: string, code: string, onNext?: () => void }) => (
    <div className="w-full max-w-sm space-y-4">
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
        <h3 className="text-sm text-slate-400 mb-2 uppercase tracking-wider">{label}</h3>
        <div 
          onClick={() => copyToClipboard(code)}
          className="bg-slate-950 p-4 rounded-lg border border-slate-800 break-all text-xs font-mono text-slate-300 h-32 overflow-y-auto cursor-pointer hover:border-blue-500 transition-colors"
        >
          {code || "Generating..."}
        </div>
        <button 
          onClick={() => copyToClipboard(code)}
          className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center gap-2 text-sm font-bold"
        >
          {copied ? <Check size={16} className="text-green-500"/> : <Copy size={16}/>} 
          {copied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      {onNext && (
        <div className="pt-2">
           <p className="text-center text-xs text-slate-500 mb-3">Send this code to your partner, then click below</p>
           <button onClick={onNext} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold">Next Step <ArrowLeft className="inline rotate-180 ml-1" size={16}/></button>
        </div>
      )}
    </div>
  );

  const CodeInput = ({ label, value, onChange, onSubmit, btnText }: any) => (
    <div className="w-full max-w-sm space-y-4">
      <h3 className="text-xl font-bold text-center">{label}</h3>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste code here..."
        className="w-full h-32 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl p-3 text-xs font-mono outline-none resize-none"
      />
      <button 
        onClick={onSubmit}
        disabled={!value}
        className={`w-full py-3 rounded-xl font-bold transition-all ${value ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
      >
        {btnText}
      </button>
      {errorMsg && <p className="text-red-400 text-sm text-center">{errorMsg}</p>}
    </div>
  );

  // --- Views ---

  const renderHome = () => (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="text-center space-y-2">
         <div className="flex justify-center"><ShieldCheck size={64} className="text-blue-500" /></div>
         <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">Chkobba Offline</h1>
         <p className="text-slate-400 text-sm">No Internet Required • Wi-Fi LAN</p>
      </div>

      <div className="bg-yellow-900/20 border border-yellow-900/50 p-4 rounded-xl text-xs text-yellow-200/80 max-w-xs text-center">
        Ensure both phones are on the same Wi-Fi or one is connected to the other's <strong>Hotspot</strong>.
      </div>

      <div className="w-full max-w-xs space-y-4">
        <button onClick={startHost} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg flex items-center justify-center gap-3">
          <Upload size={20}/> I am Host (Player 1)
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
          <div className="relative flex justify-center text-sm"><span className="px-2 bg-slate-950 text-slate-500">OR</span></div>
        </div>
        <button onClick={startJoin} className="w-full py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold text-lg flex items-center justify-center gap-3">
          <Download size={20}/> I am Joiner (Player 2)
        </button>
      </div>
    </div>
  );

  // HOST FLOW
  if (view === 'CREATE_OFFER') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <button onClick={() => setView('HOME')} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
        <div className="mb-6 text-center">
           <h2 className="text-2xl font-bold text-blue-400">Step 1: Host</h2>
           <p className="text-slate-400 text-sm">Send this code to Player 2</p>
        </div>
        <CodeDisplay label="Your Host Code" code={localCode} onNext={() => { setRemoteCodeInput(''); setView('ENTER_ANSWER'); }} />
      </div>
    );
  }

  if (view === 'ENTER_ANSWER') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
         <button onClick={() => setView('CREATE_OFFER')} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
         <div className="mb-6 text-center">
           <h2 className="text-2xl font-bold text-blue-400">Step 3: Connect</h2>
           <p className="text-slate-400 text-sm">Paste the code you received from Player 2</p>
        </div>
         <CodeInput 
            label="" 
            btnText="Finalize Connection" 
            value={remoteCodeInput} 
            onChange={setRemoteCodeInput} 
            onSubmit={processAnswer} 
         />
      </div>
    );
  }

  // JOINER FLOW
  if (view === 'ENTER_OFFER') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
         <button onClick={() => setView('HOME')} className="absolute top-6 left-6 text-slate-500"><ArrowLeft/></button>
         <div className="mb-6 text-center">
           <h2 className="text-2xl font-bold text-green-400">Step 2: Join</h2>
           <p className="text-slate-400 text-sm">Paste the code from Player 1</p>
        </div>
         <CodeInput 
            label="" 
            btnText="Generate Reply" 
            value={remoteCodeInput} 
            onChange={setRemoteCodeInput} 
            onSubmit={processOfferAndGenerateAnswer} 
         />
      </div>
    );
  }

  if (view === 'SHOW_ANSWER') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="mb-6 text-center">
           <h2 className="text-2xl font-bold text-green-400">Step 2.5: Reply</h2>
           <p className="text-slate-400 text-sm">Send this reply back to Player 1</p>
        </div>
        <CodeDisplay label="Your Reply Code" code={localCode} />
        <p className="mt-8 text-slate-500 animate-pulse text-sm">Waiting for connection...</p>
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
              <span className="text-[10px] text-slate-500 font-mono">OFFLINE MODE</span>
              <span className="text-xs font-bold tracking-wider text-green-400">CONNECTED</span>
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