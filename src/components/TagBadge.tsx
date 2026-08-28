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
  default: 'bg-inset text-secondary hover:bg-card-hover border border-divider',
  primary: 'bg-accent text-on-accent',
  success: 'bg-success/15 text-success border border-success/30',
  warning: 'bg-warning/10 border-warning/30 text-warning',
  danger: 'bg-danger/10 border-danger/30 text-danger',
};

const sizeStyles = {
  sm: 'px-2 py-1 text-[10px]',
  md: 'px-3 py-1.5 text-xs',
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
  const activeVariant = isSelected ? 'primary' : variant;
  const baseStyles = `
    rounded-chip font-medium transition-colors
    ${sizeStyles[size]}
    ${variantStyles[activeVariant]}
    ${onClick ? 'cursor-pointer' : ''}
    ${className}
  `
    .trim()
    .replace(/\s+/g, ' ');

  return (
    <button type="button" onClick={onClick} className={baseStyles} data-tag-id={tagId}>
      {tagName}
    </button>
  );
};

export default TagBadge;
