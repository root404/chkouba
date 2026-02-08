import React, { useRef, useEffect, useState } from 'react';
import { Stroke, Point } from '../types';

interface DrawingBoardProps {
  strokes: Stroke[];
  onStrokeComplete: (points: Point[]) => void;
  color: string;
}

export const DrawingBoard: React.FC<DrawingBoardProps> = ({ strokes, onStrokeComplete, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef<Point[]>([]);

  // Helper to get normalized coordinates (0-1)
  const getCoords = (e: MouseEvent | TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  // Draw a single stroke
  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) => {
    if (stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = 6; // Thicker lines for better visibility
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = stroke.points[0];
    ctx.moveTo(first.x * width, first.y * height);

    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x * width, p.y * height);
    }
    ctx.stroke();
  };

  // Redraw everything
  const renderCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Match container size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved strokes
    strokes.forEach(s => drawStroke(ctx, s, canvas.width, canvas.height));

    // Draw current stroke being drawn (Local feedback)
    if (isDrawing && currentPath.current.length > 0) {
      drawStroke(
        ctx, 
        { id: 'temp', points: currentPath.current, color: color, isRemote: false }, 
        canvas.width, 
        canvas.height
      );
    }
  };

  useEffect(() => {
    renderCanvas();
    window.addEventListener('resize', renderCanvas);
    return () => window.removeEventListener('resize', renderCanvas);
  }, [strokes, isDrawing]); // Re-render when strokes change or drawing state changes

  // Event Handlers
  const startDrawing = (e: any) => {
    setIsDrawing(true);
    currentPath.current = [];
    const pt = getCoords(e.nativeEvent);
    if (pt) currentPath.current.push(pt);
  };

  const moveDrawing = (e: any) => {
    if (!isDrawing) return;
    // Prevent scrolling on mobile while drawing
    e.preventDefault(); 
    const pt = getCoords(e.nativeEvent);
    if (pt) {
      currentPath.current.push(pt);
      // Force re-render for live feedback
      renderCanvas();
    }
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPath.current.length > 0) {
      onStrokeComplete([...currentPath.current]);
    }
    currentPath.current = [];
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden touch-none select-none">
      {/* Background Grid Guide (Optional visual flair) */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(circle, #475569 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
      </div>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        onMouseDown={startDrawing}
        onMouseMove={moveDrawing}
        onMouseUp={endDrawing}
        onMouseLeave={endDrawing}
        onTouchStart={startDrawing}
        onTouchMove={moveDrawing}
        onTouchEnd={endDrawing}
      />
      
      {strokes.length === 0 && !isDrawing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 text-slate-500">
          <p className="text-xl font-handwriting">Draw numbers (e.g. 7, 10)...</p>
        </div>
      )}
    </div>
  );
};