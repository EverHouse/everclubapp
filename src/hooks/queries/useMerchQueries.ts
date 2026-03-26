import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithCredentials, postWithCredentials, putWithCredentials, deleteWithCredentials } from './useFetch';
import type { MerchItem } from '../../types/data';
import { merchKeys } from './adminKeys';

export { merchKeys };

interface MerchItemResponse {
  id: number | string;
  name: string;
  price: number | string;
  description?: string;
  type?: string;
  icon?: string;
  imageUrl?: string;
  image_url?: string;
  image?: string;
  isActive?: boolean;
  is_active?: boolean;
  sortOrder?: number;
  sort_order?: number;
  stockQuantity?: number;
  stock_quantity?: number;
  synced?: boolean;
  syncError?: string;
}

const formatMerchItem = (item: MerchItemResponse): MerchItem => ({
  id: item.id.toString(),
  name: item.name,
  price: parseFloat(item.price as string) || 0,
  description: item.description || '',
  type: item.type || 'Apparel',
  icon: item.icon || '',
  image: item.imageUrl || item.image_url || item.image || '',
  isActive: item.isActive ?? item.is_active ?? true,
  sortOrder: item.sortOrder ?? item.sort_order ?? 0,
  stockQuantity: item.stockQuantity ?? item.stock_quantity ?? undefined,
});

export function useMerchItems(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive ?? false;
  return useQuery({
    queryKey: [...merchKeys.items(), { includeInactive }],
    queryFn: async () => {
      const url = includeInactive ? '/api/merch?include_inactive=true' : '/api/merch';
      const data = await fetchWithCredentials<MerchItemResponse[]>(url);
      return Array.isArray(data) ? data.map(formatMerchItem) : [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateMerchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Omit<MerchItem, 'id'>) =>
      postWithCredentials<MerchItemResponse & { synced?: boolean; syncError?: string }>('/api/merch', {
        name: item.name,
        price: item.price,
        description: item.description,
        type: item.type,
        icon: item.icon,
        image_url: item.image,
        is_active: item.isActive,
        sort_order: item.sortOrder,
        stock_quantity: item.stockQuantity ?? null,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: merchKeys.items() });
    },
  });
}

export function useUpdateMerchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: MerchItem) =>
      putWithCredentials<MerchItemResponse>(`/api/merch/${item.id}`, {
        name: item.name,
        price: item.price,
        description: item.description,
        type: item.type,
        icon: item.icon,
        image_url: item.image,
        is_active: item.isActive,
        sort_order: item.sortOrder,
        stock_quantity: item.stockQuantity ?? null,
      }),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: merchKeys.items() });
      const allCaches = queryClient.getQueriesData<MerchItem[]>({ queryKey: merchKeys.items() });
      allCaches.forEach(([key]) => {
        queryClient.setQueryData<MerchItem[]>(key, (old) => {
          if (!old) return old;
          return old.map(i => i.id === item.id ? { ...item } : i);
        });
      });
      return { snapshots: allCaches };
    },
    onError: (_err, _item, context) => {
      context?.snapshots?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: merchKeys.items() });
    },
  });
}

export function useDeleteMerchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteWithCredentials<{ success: boolean }>(`/api/merch/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: merchKeys.items() });
      const allCaches = queryClient.getQueriesData<MerchItem[]>({ queryKey: merchKeys.items() });
      allCaches.forEach(([key]) => {
        queryClient.setQueryData<MerchItem[]>(key, (old) => {
          if (!old) return old;
          return old.filter(i => String(i.id) !== String(id));
        });
      });
      return { snapshots: allCaches };
    },
    onError: (_err, _id, context) => {
      context?.snapshots?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: merchKeys.items() });
    },
  });
}
