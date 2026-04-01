import { useState, useCallback, useEffect } from 'react';

export function useFormPersistence<T>(formKey: string, defaultValue: T): [T, (data: T) => void, () => void] {
  const [data, setData] = useState<T>(defaultValue);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(formKey);
      if (stored) {
        setData(JSON.parse(stored) as T);
      } else {
        setData(defaultValue);
      }
    } catch (e) {
      console.warn('[FormPersistence] Failed to restore form data:', e);
      setData(defaultValue);
    }
  }, [formKey]);

  const setPersistData = useCallback((newData: T) => {
    setData(newData);
    try {
      sessionStorage.setItem(formKey, JSON.stringify(newData));
    } catch (e) { console.warn('[FormPersistence] Failed to persist form data:', e); }
  }, [formKey]);

  const clearPersistedData = useCallback(() => {
    setData(defaultValue);
    try {
      sessionStorage.removeItem(formKey);
    } catch (e) { console.warn('[FormPersistence] Failed to clear persisted data:', e); }
  }, [formKey, defaultValue]);

  return [data, setPersistData, clearPersistedData];
}
