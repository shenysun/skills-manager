import { logText } from './useApi';
export function useToasts() { return { toast: (message: string) => { logText.value = message; } }; }
