import { useNotification } from 'naive-ui';
import { ApiError, runApi } from './useApi';

type OperationNotificationOptions = {
  loading: string;
  success: string;
  error?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useOperationNotification() {
  const notification = useNotification();

  async function runWithNotification<T>(fn: () => Promise<T>, options: OperationNotificationOptions) {
    try {
      const result = await runApi(fn, { label: options.loading });
      notification.success({ title: options.success, duration: 2600, keepAliveOnHover: true });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'distribute_foreign_exists') throw error;
      notification.error({ title: options.error || options.loading, content: errorMessage(error), duration: 5200, keepAliveOnHover: true });
      throw error;
    }
  }

  return { runWithNotification };
}
