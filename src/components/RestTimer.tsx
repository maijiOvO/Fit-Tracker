/**
 * 休息计时器 — 悬浮可拖拽
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { History, Minimize2, GripHorizontal, X, Pause, Play } from 'lucide-react';
import { playTimerSound } from '../constants';
import { Haptics } from '@capacitor/haptics';

interface RestTimerProps {
  isResting: boolean;
  restSeconds: number;
  setRestSeconds: (seconds: number | ((prev: number) => number)) => void;
  setIsResting: (resting: boolean) => void;
  onAdjustTime: (delta: number) => void;
}

export const RestTimer: React.FC<RestTimerProps> = ({
  isResting,
  restSeconds,
  setRestSeconds,
  setIsResting,
  onAdjustTime,
}) => {
  const [timerMinimized, setTimerMinimized] = useState(false);
  const prevIsRestingRef = useRef(false);

  useEffect(() => {
    if (isResting && !prevIsRestingRef.current) {
      setTimerMinimized(false);
    }
    prevIsRestingRef.current = isResting;
  }, [isResting]);

  const [timerPos, setTimerPos] = useState({ x: 20, y: 100 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const draggingRef = useRef({
    isDragging: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    initialRight: 0,
    initialBottom: 0,
  });

  const isRestingRef = useRef(isResting);
  useEffect(() => {
    isRestingRef.current = isResting;
  }, [isResting]);

  const prevRestSecondsRef = useRef(restSeconds);
  useEffect(() => {
    if (prevRestSecondsRef.current > 0 && restSeconds === 0 && isRestingRef.current) {
      playTimerSound();
      try {
        Haptics.vibrate({ duration: 500 });
      } catch {
        if (navigator.vibrate) navigator.vibrate(500);
      }
      let count = 0;
      const vibrate = () => {
        count++;
        if (count < 4) {
          try {
            Haptics.vibrate({ duration: 500 });
          } catch {
            if (navigator.vibrate) navigator.vibrate(500);
          }
          setTimeout(vibrate, 1200);
        }
      };
      setTimeout(vibrate, 1000);
    }
    prevRestSecondsRef.current = restSeconds;
  }, [restSeconds]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setIsDraggingState(true);
    draggingRef.current = {
      isDragging: true,
      hasMoved: false,
      startX: e.clientX,
      startY: e.clientY,
      initialRight: timerPos.x,
      initialBottom: timerPos.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current.isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    const deltaX = draggingRef.current.startX - e.clientX;
    const deltaY = draggingRef.current.startY - e.clientY;
    if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;
    draggingRef.current.hasMoved = true;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const elWidth = timerMinimized ? 64 : 300;
    const elHeight = timerMinimized ? 64 : 160;
    const safeMargin = 20;
    let newX = draggingRef.current.initialRight + deltaX;
    let newY = draggingRef.current.initialBottom + deltaY;
    newX = Math.max(safeMargin, Math.min(newX, screenW - elWidth - safeMargin));
    newY = Math.max(30, Math.min(newY, screenH - elHeight - safeMargin));
    setTimerPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current.isDragging) return;
    draggingRef.current.isDragging = false;
    setIsDraggingState(false);
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    if (!draggingRef.current.hasMoved && timerMinimized) {
      setTimerMinimized(false);
      return;
    }
    if (timerMinimized) {
      const screenW = window.innerWidth;
      const elWidth = 64;
      const safeMargin = 10;
      const isLeft = timerPos.x > screenW / 2;
      if (isLeft) {
        setTimerPos(prev => ({ ...prev, x: screenW - elWidth - safeMargin }));
      } else {
        setTimerPos(prev => ({ ...prev, x: safeMargin }));
      }
    }
  };

  const handleTogglePause = useCallback(() => {
    if (isResting) setIsResting(false);
    else if (restSeconds > 0) setIsResting(true);
  }, [isResting, restSeconds, setIsResting]);

  useEffect(() => {
    if (restSeconds === 0 && isResting) setIsResting(false);
  }, [restSeconds, isResting, setIsResting]);

  if (!isResting && timerMinimized) return null;

  const timeStr = `${Math.floor(restSeconds / 60)}:${(restSeconds % 60).toString().padStart(2, '0')}`;

  return (
    <div
      className={`fixed z-[100] touch-none cursor-move select-none ${isDraggingState ? 'transition-none' : 'transition-all duration-300 ease-out'}`}
      style={{ right: `${timerPos.x}px`, bottom: `${timerPos.y}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {timerMinimized ? (
        <div
          className="bg-accent text-white w-14 h-14 rounded-full shadow-elevated flex items-center justify-center ring-4 ring-base active:scale-95"
          onClick={e => {
            e.stopPropagation();
            setTimerMinimized(false);
          }}
        >
          <span className="text-sm font-mono font-medium tabular-nums">{timeStr}</span>
        </div>
      ) : (
        <div className="bg-card text-primary p-4 rounded-card shadow-elevated w-[min(300px,calc(100vw-40px))] border border-divider">
          <div className="flex justify-between items-center mb-3 border-b border-divider pb-2">
            <GripHorizontal size={16} className="text-tertiary" strokeWidth={1.75} />
            <div className="flex gap-1">
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => setTimerMinimized(true)}
                className="p-1.5 hover:bg-inset rounded-chip text-tertiary"
              >
                <Minimize2 size={16} strokeWidth={1.75} />
              </button>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => setIsResting(false)}
                className="p-1.5 hover:bg-inset rounded-chip text-tertiary"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-accent-soft rounded-full">
                <History size={18} className="text-accent" strokeWidth={1.75} />
              </div>
              <span className="text-3xl font-mono font-medium tabular-nums text-primary">{timeStr}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => onAdjustTime(-10)}
                className="w-8 h-8 flex items-center justify-center bg-inset rounded-full text-[10px] font-mono font-medium text-secondary"
              >
                -10
              </button>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={handleTogglePause}
                className="w-9 h-9 flex items-center justify-center bg-accent text-white rounded-full"
              >
                {isResting ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => onAdjustTime(30)}
                className="w-8 h-8 flex items-center justify-center bg-inset rounded-full text-[10px] font-mono font-medium text-secondary"
              >
                +30
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RestTimer;
