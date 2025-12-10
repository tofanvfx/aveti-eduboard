import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Slide, Stroke, ToolType, Point, WhiteboardHandle } from '../types';

interface WhiteboardProps {
  slide: Slide;
  tool: ToolType;
  color: string;
  width: number;
  screenStream: MediaStream | null; // NEW: Accept screen stream
  onUpdateSlide: (slideId: string, strokes: Stroke[]) => void;
}

// Laser Constants
const LASER_HOLD_MS = 2000;   // Keep visible for 2 seconds after writing stops
const LASER_FADE_MS = 1000;   // Fade out over 1 second

const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(({ slide, tool, color, width, screenStream, onUpdateSlide }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const memCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null); // NEW: Video element for screen share
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [showCursor, setShowCursor] = useState(false);

  // Laser State
  const laserState = useRef({
      lastActive: 0,
  });

  // Expose canvas to parent for recording
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current
  }));

  // --- SCREEN SHARE SETUP ---
  useEffect(() => {
    const video = videoRef.current;
    if (screenStream && video) {
        video.srcObject = screenStream;
        video.play().catch(e => console.error("Error playing screen stream", e));
        
        const handleResize = () => {
            // Resize canvas to match the screen share resolution
            if (video.videoWidth && video.videoHeight) {
                setCanvasSize({ width: video.videoWidth, height: video.videoHeight });
            }
        };

        video.addEventListener('loadedmetadata', handleResize);
        video.addEventListener('resize', handleResize);

        return () => {
            video.removeEventListener('loadedmetadata', handleResize);
            video.removeEventListener('resize', handleResize);
        };
    } else {
        // Reset to default or slide size when stream stops
        if (backgroundImage) {
            setCanvasSize({ width: backgroundImage.width, height: backgroundImage.height });
        } else {
            setCanvasSize({ width: 1920, height: 1080 });
        }
    }
  }, [screenStream, backgroundImage]);


  // Load background image (Static Slides)
  useEffect(() => {
    if (screenStream) return; // Screen share takes precedence

    if (!slide.fullUrl) {
      setBackgroundImage(null);
      setCanvasSize({ width: 1920, height: 1080 });
      return;
    }
    const img = new Image();
    img.src = slide.fullUrl;
    img.onload = () => {
      setBackgroundImage(img);
      if (!screenStream) {
          setCanvasSize({ width: img.width, height: img.height });
      }
    };
  }, [slide.fullUrl, screenStream]);

  // Helper to get coordinates relative to canvas resolution
  const getCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      t: Date.now()
    };
  };

  const updateCursorPosition = (e: React.MouseEvent | React.TouchEvent) => {
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    
    if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCursorPos({
            x: clientX - rect.left,
            y: clientY - rect.top
        });
    }
  };

  const renderStroke = (ctx: CanvasRenderingContext2D, s: Stroke, opacityOverride?: number) => {
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 0;

      // --- LASER RENDER LOGIC ---
      if (s.tool === ToolType.LASER) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = s.color;
          ctx.globalCompositeOperation = 'source-over';
          
          if (s.points.length < 1) return;

          // opacityOverride acts as "Life/Visibility" factor (0.0 to 1.0)
          // undefined means 1.0 (active drawing)
          const life = opacityOverride !== undefined ? opacityOverride : 1.0;

          if (life <= 0) return;

          // SMOOTH FADE: Use globalAlpha for transparency fade instead of retraction
          ctx.globalAlpha = life; 
          const startIndex = 0;

          for (let i = startIndex; i < s.points.length - 1; i++) {
            const p1 = s.points[i];
            const p2 = s.points[i+1];
            
            // Taper calculation: Head (end of array) is thick, Tail (start of array) is thinner
            const progress = i / s.points.length;
            const taperFactor = 0.5 + (0.5 * progress); 

            ctx.beginPath();
            ctx.lineWidth = Math.max(1, s.width * taperFactor); 
            ctx.strokeStyle = s.color;
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }

          // Draw "Bulb" at end if we still have life
          if (life > 0) {
             const last = s.points[s.points.length-1];
             ctx.beginPath();
             ctx.fillStyle = s.color;
             ctx.arc(last.x, last.y, s.width / 1.5, 0, Math.PI * 2);
             ctx.fill();
          }

          return;
      }

      // --- STANDARD TOOLS RENDER LOGIC ---
      ctx.beginPath();
      ctx.strokeStyle = s.color;

      if (s.tool === ToolType.HIGHLIGHTER) {
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'multiply';
        if (!s.color) ctx.strokeStyle = '#ffff00'; 
      } else if (s.tool === ToolType.ERASER) {
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = 'rgba(0,0,0,1)'; 
      } else {
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
      }

      if (s.points.length === 0) return;

      if (s.tool === ToolType.PEN || s.tool === ToolType.HIGHLIGHTER || s.tool === ToolType.ERASER) {
         ctx.moveTo(s.points[0].x, s.points[0].y);
         if (s.points.length > 2) {
             for (let i = 1; i < s.points.length - 2; i++) {
                 const xc = (s.points[i].x + s.points[i + 1].x) / 2;
                 const yc = (s.points[i].y + s.points[i + 1].y) / 2;
                 ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
             }
             ctx.quadraticCurveTo(
                 s.points[s.points.length - 2].x,
                 s.points[s.points.length - 2].y,
                 s.points[s.points.length - 1].x,
                 s.points[s.points.length - 1].y
             );
         } else {
             for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x, s.points[i].y);
             }
         }
         ctx.stroke();
      } else if (s.tool === ToolType.RECTANGLE) {
         const start = s.points[0];
         const end = s.points[s.points.length - 1];
         ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (s.tool === ToolType.CIRCLE) {
         const start = s.points[0];
         const end = s.points[s.points.length - 1];
         const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
         ctx.beginPath();
         ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
         ctx.stroke();
      } else if (s.tool === ToolType.ARROW) {
         const start = s.points[0];
         const end = s.points[s.points.length - 1];
         const headLen = s.width * 5; 
         const angle = Math.atan2(end.y - start.y, end.x - start.x);
         ctx.moveTo(start.x, start.y);
         ctx.lineTo(end.x, end.y);
         ctx.stroke();
         
         ctx.beginPath();
         ctx.moveTo(end.x, end.y);
         ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
         ctx.moveTo(end.x, end.y);
         ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
         ctx.stroke();
      }
  };

  // Redraw entire canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // --- Layer 1: Background (Screen Share OR Image OR White) ---
    ctx.globalCompositeOperation = 'source-over';
    
    // NOTE: Don't clear rect if drawing video, video covers it. 
    // But good practice to clear for transparency edge cases.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (screenStream && videoRef.current) {
        // Draw the Live Video Frame
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    } else if (backgroundImage) {
      ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // --- Layer 2: Ink ---
    if (!memCanvasRef.current) {
        memCanvasRef.current = document.createElement('canvas');
    }
    const memCanvas = memCanvasRef.current;
    if (memCanvas.width !== canvas.width || memCanvas.height !== canvas.height) {
        memCanvas.width = canvas.width;
        memCanvas.height = canvas.height;
    }

    const memCtx = memCanvas.getContext('2d');
    if (!memCtx) return;
    memCtx.clearRect(0, 0, memCanvas.width, memCanvas.height);

    const now = Date.now();
    let hasLaser = false;
    let laserOpacity = 0;
    
    // Check if we are actively using the laser
    const isDrawingLaser = isDrawing && currentStroke?.tool === ToolType.LASER;

    if (isDrawingLaser) {
        laserOpacity = 1.0;
        hasLaser = true;
    } else {
        const timeSinceActive = now - laserState.current.lastActive;
        
        if (timeSinceActive < LASER_HOLD_MS) {
            laserOpacity = 1.0;
            hasLaser = true;
        } else if (timeSinceActive < LASER_HOLD_MS + LASER_FADE_MS) {
            laserOpacity = 1 - ((timeSinceActive - LASER_HOLD_MS) / LASER_FADE_MS);
            hasLaser = true;
        } else {
            laserOpacity = 0;
        }
    }

    // --- Draw Strokes ---
    slide.strokes.forEach(stroke => {
        if (stroke.tool === ToolType.LASER) {
             if (laserOpacity > 0) {
                 renderStroke(memCtx, stroke, laserOpacity);
                 // hasLaser is already set true above if opacity > 0
             }
        } else {
             renderStroke(memCtx, stroke);
        }
    });

    // Draw active stroke
    if (currentStroke) {
        renderStroke(memCtx, currentStroke); 
    }

    // Composite Ink Layer
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(memCanvas, 0, 0);

    // --- Cleanup Logic ---
    // If the laser opacity hit 0 and we aren't drawing with it, clear the data
    const existingLasers = slide.strokes.some(s => s.tool === ToolType.LASER);
    
    if (existingLasers && laserOpacity <= 0 && !isDrawingLaser) {
         // Perform state update in timeout to avoid render-loop conflicts
         setTimeout(() => {
             const nonLaserStrokes = slide.strokes.filter(s => s.tool !== ToolType.LASER);
             if (nonLaserStrokes.length !== slide.strokes.length) {
                 onUpdateSlide(slide.id, nonLaserStrokes);
             }
         }, 0);
    }
    
    // Return true if we need to keep animating (laser fading OR screen share active)
    return isDrawing || (existingLasers && laserOpacity > 0) || !!screenStream;

  }, [slide.strokes, currentStroke, backgroundImage, slide.id, onUpdateSlide, isDrawing, screenStream]);


  // Handle Resize & Resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    // Trigger a redraw immediately when size changes
    requestAnimationFrame(redraw);
  }, [canvasSize, redraw]);

  // Animation Loop
  useEffect(() => {
      let isAnimating = true;
      const loop = () => {
          if (!isAnimating) return;
          const shouldContinue = redraw();
          if (shouldContinue) {
              animationFrameRef.current = requestAnimationFrame(loop);
          } else {
             animationFrameRef.current = null; 
          }
      };
      
      loop();
      return () => {
          isAnimating = false;
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };
  }, [redraw]);


  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    updateCursorPosition(e);
    const p = getCoords(e);
    
    if (tool === ToolType.LASER) {
        laserState.current.lastActive = Date.now();
    }

    const newStroke: Stroke = {
        id: crypto.randomUUID(),
        tool: tool,
        color: tool === ToolType.ERASER ? '#000000' : color, 
        width: tool === ToolType.ERASER ? width * 5 : width, 
        points: [p]
    };
    setCurrentStroke(newStroke);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    updateCursorPosition(e);
    if (!isDrawing || !currentStroke) return;
    const p = getCoords(e);
    
    if (tool === ToolType.LASER) {
        laserState.current.lastActive = Date.now();
    }

    if ([ToolType.RECTANGLE, ToolType.CIRCLE, ToolType.ARROW].includes(tool)) {
        setCurrentStroke(prev => prev ? { ...prev, points: [prev.points[0], p] } : null);
    } else {
        setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, p] } : null);
    }
  };

  const stopDrawing = () => {
    if (!isDrawing || !currentStroke) return;
    setIsDrawing(false);
    
    if (tool === ToolType.LASER) {
        laserState.current.lastActive = Date.now();
    }

    onUpdateSlide(slide.id, [...slide.strokes, currentStroke]);
    setCurrentStroke(null);
  };

  const isEraser = tool === ToolType.ERASER;
  const eraserCursorSize = width * 5; 

  return (
    <div 
        ref={containerRef} 
        className={`relative w-full h-full flex items-center justify-center overflow-hidden touch-none bg-gray-200 dark:bg-black ${isEraser ? 'cursor-none' : ''}`}
        onMouseEnter={() => setShowCursor(true)}
        onMouseLeave={() => setShowCursor(false)}
    >
       {/* Hidden Video Element for Screen Capture Source */}
       <video ref={videoRef} className="hidden" muted playsInline />

       {/* Eraser Cursor Overlay */}
       {isEraser && showCursor && (
           <div 
             className="absolute rounded-full border-2 border-gray-800 dark:border-white bg-white/20 pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2 shadow-sm"
             style={{ 
                 left: cursorPos.x, 
                 top: cursorPos.y,
                 width: `${eraserCursorSize}px`,
                 height: `${eraserCursorSize}px`
             }}
           />
       )}

       <canvas
         ref={canvasRef}
         className="shadow-lg bg-white touch-none cursor-crosshair"
         style={{ 
            maxWidth: '100%', 
            maxHeight: '100%',
            aspectRatio: `${canvasSize.width} / ${canvasSize.height}`
         }}
         onMouseDown={startDrawing}
         onMouseMove={draw}
         onMouseUp={stopDrawing}
         onMouseLeave={stopDrawing}
         onTouchStart={startDrawing}
         onTouchMove={draw}
         onTouchEnd={stopDrawing}
       />
    </div>
  );
});

export default Whiteboard;