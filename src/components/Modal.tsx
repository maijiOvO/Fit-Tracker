/**
 * 通用模态框组件
 */
import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  className?: string;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-2xl',
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  showCloseButton = true,
  className = '',
}) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in"
      onClick={onClose}
    >
      <div 
        className={`bg-slate-900 border border-slate-800 w-full ${sizeStyles[size]} rounded-[2rem] p-8 space-y-6 shadow-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="flex justify-between items-start">
            <div>
              {title && <h2 className="text-xl font-black">{title}</h2>}
              {subtitle && <p className="text-xs text-slate-500 font-bold mt-1">{subtitle}</p>}
            </div>
            {showCloseButton && (
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-800 rounded-full transition-colors"
              >
                <X size={20} className="text-slate-400" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default Modal;
