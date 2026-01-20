import React, { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export interface SelectedMember {
  id: number;
  email: string;
  name: string;
  tier: string | null;
  stripeCustomerId?: string | null;
}

// Simple debounce hook
function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

interface MemberSearchInputProps {
  onSelect: (member: SelectedMember) => void;
  onClear?: () => void;
  placeholder?: string;
  label?: string;
  selectedMember?: SelectedMember | null;
  disabled?: boolean;
  className?: string;
  showTier?: boolean;
  autoFocus?: boolean;
  privacyMode?: boolean;
}

const redactEmail = (email: string): string => {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visibleChars = Math.min(2, local.length);
  const redacted = local.slice(0, visibleChars) + '***';
  return `${redacted}@${domain}`;
};

export const MemberSearchInput: React.FC<MemberSearchInputProps> = ({
  onSelect,
  onClear,
  placeholder = 'Search by name or email...',
  label,
  selectedMember,
  disabled = false,
  className = '',
  showTier = true,
  autoFocus = false,
  privacyMode = false
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const searchMembers = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/members/search?query=${encodeURIComponent(searchQuery)}&limit=8`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();

      // The API now returns `emailRedacted` but we need the full email for selection.
      // This component is used in admin/staff areas, so we'll fetch full member profiles.
      // For now, let's assume the search endpoint will be updated to return full data for authorized users.
      // Awaiting that, we'll map what we have.
      setResults(data.map((m: any) => ({
        ...m,
        email: m.email || m.emailRedacted, // Use full email if available
      })));
      setIsOpen(true);
    } catch (error) {
      toast.error('Failed to search for members.');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    searchMembers(debouncedQuery);
  }, [debouncedQuery, searchMembers]);

  useEffect(() => {
    if (selectedMember) {
      setQuery(selectedMember.name);
      setIsOpen(false);
    } else {
      setQuery('');
      setIsOpen(false);
    }
  }, [selectedMember]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [results.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (selectedMember && onClear) {
      onClear();
    }
  };

  const handleSelect = (member: any) => {
    const selected: SelectedMember = {
      id: member.id,
      email: member.email,
      name: member.name,
      tier: member.tier || null,
      stripeCustomerId: member.stripeCustomerId || null
    };
    setQuery(member.name);
    setIsOpen(false);
    onSelect(selected);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlightedIndex]) {
        handleSelect(results[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setIsOpen(false);
    if (onClear) onClear();
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label htmlFor="member-search-input" className="block text-sm font-medium text-primary dark:text-white mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-primary/40 dark:text-white/40 text-lg">
          search
        </span>
        <input
          id="member-search-input"
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim() && setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className="w-full pl-10 pr-10 py-2.5 border border-primary/20 dark:border-white/20 rounded-xl bg-white dark:bg-black/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:focus:ring-lavender/30 disabled:opacity-50"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/40 dark:text-white/40 hover:text-primary dark:hover:text-white"
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">close</span>
          </button>
        )}
      </div>

      <div
        ref={dropdownRef}
        className="absolute left-0 right-0 top-full mt-1 z-[9999] bg-white dark:bg-gray-900 border border-primary/10 dark:border-white/10 rounded-xl shadow-xl overflow-hidden"
        style={{ display: isOpen ? 'block' : 'none' }}
      >
        {isLoading && (
          <div className="p-4 text-center text-sm text-primary/60 dark:text-white/60">Loading...</div>
        )}
        {!isLoading && results.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            {results.map((member, index) => (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSelect(member)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full px-4 py-3 flex items-center gap-3 border-b border-primary/5 dark:border-white/5 last:border-0 transition-colors ${
                  index === highlightedIndex
                    ? 'bg-primary/10 dark:bg-white/10'
                    : 'hover:bg-primary/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-base text-primary dark:text-white">person</span>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="font-medium text-primary dark:text-white truncate">{member.name}</p>
                  <p className="text-xs text-primary/60 dark:text-white/60 truncate">
                    {showTier && member.tier ? `${member.tier} • ` : ''}
                    {privacyMode ? redactEmail(member.email) : member.email}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
        {!isLoading && isOpen && query.trim().length > 1 && results.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-sm text-primary/60 dark:text-white/60">No members found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemberSearchInput;
