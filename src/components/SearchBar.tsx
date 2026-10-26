import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search creators, tags, or topics...',
  className = '',
}) => {
  return (
    <div className={cn('relative flex items-center w-full', className)}>
      <Search className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-10 py-2.5 bg-slate-800/80 hover:bg-slate-800 focus:bg-slate-900 text-sm text-slate-100 placeholder:text-slate-500 rounded-xl border border-slate-700/80 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            onClear?.();
          }}
          className="absolute right-3 p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-700"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
