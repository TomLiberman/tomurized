import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption { value: string; label: string }

// A styled dropdown that replaces the unstylable native <select>.
// The menu + outside-click backdrop are portalled to <body> and positioned with
// fixed coordinates measured from the trigger, so they escape any ancestor that
// establishes a containing block for fixed elements (e.g. a header's
// backdrop-filter) and always close on an outside click anywhere on screen.
export default function Dropdown({
  value,
  options,
  onChange,
  minWidth = 150,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  minWidth?: number;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const active = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, minWidth);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const top = r.bottom + 4;
      setPos({ top, left, width, maxHeight: Math.max(160, window.innerHeight - top - 12) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, minWidth]);

  return (
    <div className="dd" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className="dd-trigger"
        style={{ minWidth }}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="dd-label">{active?.label ?? '—'}</span>
        <ChevronDown size={16} className="dd-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && pos && createPortal(
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div
            className="dd-menu"
            role="listbox"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: pos.maxHeight, overflowY: 'auto' }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`dd-item ${o.value === value ? 'active' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.value === value && <Check size={15} />}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
