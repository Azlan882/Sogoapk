import React from 'react';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 rounded-lg gap-1.5',
    md: 'text-sm px-4 py-2 rounded-xl gap-2',
    lg: 'text-base px-5 py-2.5 rounded-xl gap-2.5',
  };

  const variantClasses = {
    primary: 'bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold shadow-lg shadow-cyan-500/20 active:bg-cyan-600',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:bg-slate-600',
    outline: 'border border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-200',
    ghost: 'bg-transparent hover:bg-slate-800/60 text-slate-300 active:bg-slate-700',
    danger: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 active:bg-rose-500/40',
  };

  return (
    <button
      className={cn(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {!isLoading && leftIcon}
      <span>{children}</span>
      {!isLoading && rightIcon}
    </button>
  );
};
