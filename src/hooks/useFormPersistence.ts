import { useState, useCallback } from 'react';

export function useFormPersistence<T>(formKey: string, defaultValue: T): [T, (data: T) => void, () => void] {
  const [data] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(formKey);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch {}
    return defaultValue;
  });

  const setPersistData = useCallback((newData: T) => {
    try {
      sessionStorage.setItem(formKey, JSON.stringify(newData));
    } catch {}
  }, [formKey]);

  const clearPersistedData = useCallback(() => {
    try {
      sessionStorage.removeItem(formKey);
    } catch {}
  }, [formKey]);

  return [data, setPersistData, clearPersistedData];
}
