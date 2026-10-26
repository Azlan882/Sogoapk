import React from 'react';
import { Button } from './Button';
import { cn } from '../lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
  className = '',
}) => {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center p-8 my-6', className)}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-cyan-400 mb-4 shadow-lg shadow-cyan-950/30">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5 leading-relaxed">{description}</p>
      {actionText && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </div>
  );
};
