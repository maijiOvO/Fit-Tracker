/**
 * 休息计时器组件
 * 悬浮可拖拽窗口，支持最小化/展开/贴边吸附
 * 注意：计时逻辑由外部（App.tsx）管理，此组件只负责显示和控制
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { History, Minimize2, Maximize2, GripHorizontal, X, Pause, Play } from 'lucide-react';
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
  // 当 isResting 变为 true 时，自动展开计时器
  const [timerMinimized, setTimerMinimized] = useState(false);
  const prevIsRestingRef = useRef(false);
  
  // 监听 isResting 变化，自动展开
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
    initialBottom: 0 
  });

  // 计时结束时的提示音和震动 - 使用 ref 追踪最新状态避免闭包问题
  const isRestingRef = useRef(isResting);
  useEffect(() => {
    isRestingRef.current = isResting;
  }, [isResting]);

  const prevRestSecondsRef = useRef(restSeconds);
  useEffect(() => {
    // 当 restSeconds 从 >0 变为 0 时，表示计时结束
    if (prevRestSecondsRef.current > 0 && restSeconds === 0 && isRestingRef.current) {
      playTimerSound();
      try {
        Haptics.vibrate({ duration: 500 });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate(500);
      }
      // 4 次震动提醒
      let count = 0;
      const vibrate = () => {
        count++;
        if (count < 4) {
          try {
            Haptics.vibrate({ duration: 500 });
          } catch (e) {
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
      initialBottom: timerPos.y
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
    const elWidth = timerMinimized ? 64 : 320; 
    const elHeight = timerMinimized ? 64 : 200;
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
      // 点击最小化图标，展开
      setTimerMinimized(false);
      return;
    }

    if (timerMinimized) {
      const screenW = window.innerWidth;
      const elWidth = 64;
      const safeMargin = 10;
      const isLeft = timerPos.x > (screenW / 2);

      if (isLeft) {
        setTimerPos(prev => ({ ...prev, x: screenW - elWidth - safeMargin }));
      } else {
        setTimerPos(prev => ({ ...prev, x: safeMargin }));
      }
    }
  };

  // 处理暂停/继续
  const handleTogglePause = useCallback(() => {
    if (isResting) {
      setIsResting(false);
    } else if (restSeconds > 0) {
      setIsResting(true);
    }
  }, [isResting, restSeconds, setIsResting]);

  // 当 restSeconds 变为 0 且 isResting 为 true 时，自动停止休息状态
  useEffect(() => {
    if (restSeconds === 0 && isResting) {
      setIsResting(false);
    }
  }, [restSeconds, isResting, setIsResting]);

  // 不在休息状态且已最小化时不渲染
  if (!isResting && timerMinimized) return null;

  return (
    <div 
      className={`fixed z-[100] touch-none cursor-move select-none ${isDraggingState ? 'transition-none' : 'transition-all duration-500 ease-out'}`}
      style={{ 
        right: `${timerPos.x}px`, 
        bottom: `${timerPos.y}px` 
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {timerMinimized ? (
        /* 1. 最小化状态：极简圆球 */
        <div 
          className="bg-indigo-600 text-white w-16 h-16 rounded-full shadow-2xl flex items-center justify-center border-4 border-indigo-400/30 backdrop-blur-xl relative transition-transform active:scale-90"
          onClick={(e) => {
            e.stopPropagation();
            setTimerMinimized(false);
          }}
        >
          <span className="text-sm font-black tabular-nums tracking-tighter">
            {Math.floor(restSeconds / 60)}:{(restSeconds % 60).toString().padStart(2, '0')}
          </span>
        </div>
      ) : (
        /* 2. 展开状态：完整面板 */
        <div className="bg-indigo-600 text-white p-4 rounded-[2rem] shadow-2xl shadow-indigo-600/40 w-80 border border-indigo-400/20 backdrop-blur-xl animate-in zoom-in-95 duration-200">
          
          {/* 顶部拖拽条 & 最小化 */}
          <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 opacity-50">
              <GripHorizontal size={16} />
            </div>
            <div className="flex gap-2">
              <button 
                onPointerDown={(e) => e.stopPropagation()} 
                onClick={() => setTimerMinimized(true)} 
                className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                title="最小化"
              >
                <Minimize2 size={16} />
              </button>
              <button 
                onPointerDown={(e) => e.stopPropagation()} 
                onClick={() => setIsResting(false)} 
                className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center">
            {/* 时间显示 */}
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-full animate-pulse">
                <History size={20} className="text-white" />
              </div>
              <span className="text-3xl font-black tabular-nums leading-none">
                {Math.floor(restSeconds / 60)}:{(restSeconds % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {/* 控制按钮 */}
            <div className="flex items-center gap-2">
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onAdjustTime(-10)} className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-black/30 rounded-full text-[10px] font-bold transition-colors cursor-pointer">-10</button>
              <button 
                onPointerDown={(e) => e.stopPropagation()} 
                onClick={handleTogglePause}
                className="w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full transition-colors cursor-pointer"
                title={isResting ? "暂停" : "继续"}
              >
                {isResting ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onAdjustTime(30)} className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-black/30 rounded-full text-[10px] font-bold transition-colors cursor-pointer">+30</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RestTimer;
