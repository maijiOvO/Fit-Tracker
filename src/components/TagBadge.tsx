/**
 * 标签徽章组件
 */
import React from 'react';

interface TagBadgeProps {
  tagId: string;
  tagName: string;
  isSelected?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles = {
  default: 'bg-slate-800 text-slate-400 hover:bg-slate-700',
  primary: 'bg-blue-600 text-white shadow-lg',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
  danger: 'bg-red-500/20 border-red-500/50 text-red-400',
};

const sizeStyles = {
  sm: 'px-2 py-1 text-[10px]',
  md: 'px-4 py-2 text-xs',
};

export const TagBadge: React.FC<TagBadgeProps> = ({
  tagId,
  tagName,
  isSelected = false,
  onClick,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  const baseStyles = `
    rounded-xl font-black uppercase tracking-wider transition-all
    ${sizeStyles[size]}
    ${variantStyles[variant]}
    ${onClick ? 'cursor-pointer' : ''}
    ${isSelected ? variantStyles.primary : ''}
    ${className}
  `.trim().replace(/\s+/g, ' ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={baseStyles}
      data-tag-id={tagId}
    >
      {tagName}
    </button>
  );
};

export default TagBadge;
