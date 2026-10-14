import { createContext, useContext } from 'react';
import type { PortalValue } from './usePortalState';

export const PortalContext = createContext<PortalValue | null>(null);

export function usePortal(): PortalValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal must be used within a PortalContext provider');
  return ctx;
}
