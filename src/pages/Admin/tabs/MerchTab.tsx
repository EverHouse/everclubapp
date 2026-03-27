import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { usePageReady } from '../../../stores/pageReadyStore';
import { useToast } from '../../../components/Toast';
import ModalShell from '../../../components/ModalShell';
import { useMerchItems, useCreateMerchItem, useUpdateMerchItem, useDeleteMerchItem } from '../../../hooks/queries/useMerchQueries';
import { useUploadCafeImage } from '../../../hooks/queries/useCafeQueries';
import type { MerchItem } from '../../../types/data';
import Icon from '../../../components/icons/Icon';

const MERCH_TYPES = ['Apparel', 'Accessories', 'Equipment', 'Drinkware', 'Other'];

const MERCH_TYPE_ICONS: Record<string, string> = {
    Apparel: 'checkroom',
    Accessories: 'watch',
    Equipment: 'sports_golf',
    Drinkware: 'local_cafe',
    Other: 'category',
};

const MerchTab: React.FC = () => {
    const { setPageReady } = usePageReady();
    const { showToast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [merchRef] = useAutoAnimate();

    const { data: merchItems = [] } = useMerchItems({ includeInactive: true });
    const uploadImageMutation = useUploadCafeImage();
    const createItemMutation = useCreateMerchItem();
    const updateItemMutation = useUpdateMerchItem();
    const deleteItemMutation = useDeleteMerchItem();

    const types = useMemo(() => ['All', ...Array.from(new Set(merchItems.map(item => item.type)))], [merchItems]);
    const [activeType, setActiveType] = useState('All');
    const [isEditing, setIsEditing] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [newItem, setNewItem] = useState<Partial<MerchItem>>({ type: 'Apparel' });
    const [uploadResult, setUploadResult] = useState<{ originalSize: number; optimizedSize: number } | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
        setPageReady(true);
    }, [setPageReady]);

    const filteredItems = activeType === 'All' ? merchItems : merchItems.filter(item => item.type === activeType);

    const openEdit = (item: MerchItem) => {
        setNewItem(item);
        setEditId(item.id);
        setIsEditing(true);
    };

    const openCreate = () => {
        setNewItem({ type: 'Apparel', price: 0, isActive: true, sortOrder: 0 });
        setEditId(null);
        setUploadResult(null);
        setIsEditing(true);
    };

    const handleImageUpload = async (file: File) => {
        try {
            const data = await uploadImageMutation.mutateAsync(file);
            setNewItem(prev => ({ ...prev, image: data.imageUrl }));
            setUploadResult({ originalSize: data.originalSize, optimizedSize: data.optimizedSize });
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to upload image', 'error');
        }
    };

    const handleSave = async () => {
        if (!newItem.name || newItem.price === undefined || newItem.price === null) return;

        if (editId) {
            const itemData: MerchItem = {
                id: editId,
                name: newItem.name,
                price: Number(newItem.price),
                description: newItem.description || '',
                type: newItem.type || 'Apparel',
                icon: newItem.icon || 'storefront',
                image: newItem.image || '',
                isActive: newItem.isActive,
                sortOrder: newItem.sortOrder ?? 0,
                stockQuantity: newItem.stockQuantity,
            };

            try {
                const result = await updateItemMutation.mutateAsync(itemData);
                const synced = result?.synced === true;
                const syncError = result?.syncError;
                showToast(
                    synced ? 'Item saved — synced to Stripe' : `Item saved — Stripe sync failed${syncError ? `: ${syncError}` : ''}`,
                    synced ? 'success' : 'error'
                );
                setIsEditing(false);
            } catch (err: unknown) {
                showToast(err instanceof Error ? err.message : 'Failed to save item', 'error');
            }
        } else {
            try {
                const result = await createItemMutation.mutateAsync({
                    name: newItem.name,
                    price: Number(newItem.price),
                    description: newItem.description || '',
                    type: newItem.type || 'Apparel',
                    icon: newItem.icon || 'storefront',
                    image: newItem.image || '',
                    isActive: newItem.isActive ?? true,
                    sortOrder: newItem.sortOrder ?? 0,
                    stockQuantity: newItem.stockQuantity,
                });
                const synced = result?.synced === true;
                const syncError = result?.syncError;
                showToast(
                    synced ? 'Item created — synced to Stripe' : `Item created — Stripe sync failed${syncError ? `: ${syncError}` : ''}`,
                    synced ? 'success' : 'error'
                );
                setIsEditing(false);
            } catch (err: unknown) {
                showToast(err instanceof Error ? err.message : 'Failed to create item', 'error');
            }
        }
    };

    const handleDelete = async () => {
        if (!editId) return;
        try {
            await deleteItemMutation.mutateAsync(editId);
            showToast('Item deleted', 'success');
            setIsEditing(false);
            setShowDeleteConfirm(false);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to delete item', 'error');
            setShowDeleteConfirm(false);
        }
    };

    const isLoading = uploadImageMutation.isPending || createItemMutation.isPending || updateItemMutation.isPending;

    return (
        <div className="animate-page-enter backdrop-blur-sm">
            <div className="flex justify-between items-center mb-4 animate-content-enter-delay-1">
                <div>
                    <h2 className="text-2xl leading-tight text-primary dark:text-white" style={{ fontFamily: 'var(--font-headline)' }}>Merchandise</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5" style={{ fontFamily: 'var(--font-body)' }}>
                        <Icon name="sync" className="text-xs" />
                        Changes sync to Stripe automatically
                    </p>
                </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide -mx-1 px-1 mb-4 animate-content-enter-delay-2 scroll-fade-right">
                {types.map(t => (
                    <button
                        key={t}
                        onClick={() => setActiveType(t)}
                        className={`flex-shrink-0 px-4 py-2 rounded-[4px] text-xs font-semibold transition-colors duration-fast ${activeType === t ? 'bg-primary dark:bg-lavender text-white shadow-md' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15'}`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            <ModalShell isOpen={isEditing} onClose={() => { setIsEditing(false); setShowDeleteConfirm(false); }} title={editId ? 'Item Details' : 'Add Merch Item'} showCloseButton={false}>
                <div className="p-6 space-y-4">
                    <input aria-label="Item name" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" placeholder="Item Name" value={newItem.name || ''} onChange={e => setNewItem({...newItem, name: e.target.value})} />
                    <div className="grid grid-cols-2 gap-3">
                        <input aria-label="Price" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" type="number" placeholder="Price" value={newItem.price || ''} onChange={e => setNewItem({...newItem, price: Number(e.target.value)})} />
                        <select aria-label="Type" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" value={newItem.type || 'Apparel'} onChange={e => setNewItem({...newItem, type: e.target.value})}>
                            {MERCH_TYPES.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <input aria-label="Sort order" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" type="number" placeholder="Sort Order" value={newItem.sortOrder ?? 0} onChange={e => setNewItem({...newItem, sortOrder: Number(e.target.value)})} />
                        <input aria-label="Stock quantity" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" type="number" min="0" placeholder="Stock (empty=unlimited)" value={newItem.stockQuantity ?? ''} onChange={e => setNewItem({...newItem, stockQuantity: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value))})} />
                        <input aria-label="Icon" className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast" placeholder="Icon (material symbol)" value={newItem.icon || ''} onChange={e => setNewItem({...newItem, icon: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-white/70">Image (Optional)</label>
                        <div className="flex gap-2">
                            <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/*"
                                className="hidden"
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) handleImageUpload(file);
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadImageMutation.isPending}
                                className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-white/20 transition-colors disabled:opacity-50"
                            >
                                <Icon name={uploadImageMutation.isPending ? 'sync' : 'upload'} className="text-lg" />
                                {uploadImageMutation.isPending ? 'Uploading...' : 'Upload'}
                            </button>
                            <input
                                className="flex-1 border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-2.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast text-sm"
                                placeholder="Or paste image URL"
                                value={newItem.image || ''}
                                onChange={e => setNewItem({...newItem, image: e.target.value})}
                            />
                        </div>
                        {uploadResult && (
                            <p className="text-xs text-green-600 dark:text-green-400">
                                Optimized: {(uploadResult.originalSize / 1024).toFixed(0)}KB → {(uploadResult.optimizedSize / 1024).toFixed(0)}KB
                            </p>
                        )}
                        {newItem.image && (
                            <div className="mt-2 relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/5">
                                <img src={newItem.image} alt="Preview" className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => { setNewItem({...newItem, image: ''}); setUploadResult(null); }}
                                    className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                                >
                                    <Icon name="close" className="text-sm" />
                                </button>
                            </div>
                        )}
                    </div>
                    <textarea className="w-full border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-black/30 p-3.5 rounded-xl text-primary dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/60 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors duration-fast resize-none" placeholder="Description" rows={3} value={newItem.description || ''} onChange={e => setNewItem({...newItem, description: e.target.value})} />
                    {editId && newItem.isActive === false && (
                        <button
                            type="button"
                            onClick={() => setNewItem({...newItem, isActive: true})}
                            className="flex items-center gap-2 w-full p-3 rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                        >
                            <Icon name="toggle_off" className="text-lg" />
                            This item is inactive — click to reactivate
                        </button>
                    )}
                    {editId && newItem.isActive !== false && (
                        <button
                            type="button"
                            onClick={() => setNewItem({...newItem, isActive: false})}
                            className="flex items-center gap-2 w-full p-3 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                        >
                            <Icon name="toggle_on" className="text-lg" />
                            Active — click to deactivate
                        </button>
                    )}
                    <div className="flex items-center pt-2">
                        {editId && !showDeleteConfirm && (
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={deleteItemMutation.isPending}
                                className="px-4 py-2.5 text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/20 rounded-[4px] transition-colors text-sm disabled:opacity-50"
                            >
                                Delete
                            </button>
                        )}
                        {editId && showDeleteConfirm && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-red-600 dark:text-red-400">Delete this item?</span>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleteItemMutation.isPending}
                                    className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-[4px] hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    {deleteItemMutation.isPending ? 'Deleting...' : 'Confirm'}
                                </button>
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    disabled={deleteItemMutation.isPending}
                                    className="px-3 py-1.5 text-gray-500 dark:text-white/60 text-xs font-bold hover:bg-gray-100 dark:hover:bg-white/10 rounded-[4px] transition-colors disabled:opacity-50"
                                >
                                    No
                                </button>
                            </div>
                        )}
                        <div className="flex gap-3 ml-auto">
                            <button onClick={() => { setIsEditing(false); setShowDeleteConfirm(false); }} className="tactile-btn px-5 py-2.5 text-gray-500 dark:text-white/80 font-bold hover:bg-gray-100 dark:hover:bg-white/10 rounded-[4px] transition-colors">Cancel</button>
                            <button onClick={handleSave} disabled={isLoading} className="tactile-btn px-6 py-2.5 bg-primary text-white rounded-[4px] font-bold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50">Save</button>
                        </div>
                    </div>
                </div>
            </ModalShell>

            <div ref={merchRef} className="space-y-3 animate-content-enter-delay-3">
                {filteredItems.map((item) => (
                    <div key={item.id} onClick={() => openEdit(item)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(item); } }} role="button" tabIndex={0} className={`bg-white dark:bg-surface-dark p-4 rounded-xl shadow-sm border border-gray-200 dark:border-white/20 flex items-center gap-4 cursor-pointer hover:border-primary/30 transition-colors tactile-card ${item.isActive === false ? 'opacity-50' : ''}`}>
                        <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-white/5 flex-shrink-0 overflow-hidden">
                             {item.image ? <img src={item.image} className="w-full h-full object-cover" alt={item.name || 'Merch item image'} /> : <div className="w-full h-full flex items-center justify-center"><Icon name={MERCH_TYPE_ICONS[item.type] || 'storefront'} className="text-gray-600" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-gray-900 dark:text-white truncate flex-1">{item.name}</h4>
                                {item.isActive === false && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-[4px]">Inactive</span>
                                )}
                                <span className="font-bold text-primary dark:text-white whitespace-nowrap">${item.price}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 mb-1">
                                <span className="inline-block text-[11px] font-semibold uppercase tracking-widest w-fit bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/80 px-2 py-0.5 rounded-[4px]" style={{ fontFamily: 'var(--font-label)' }}>{item.type}</span>
                                <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${item.stockQuantity == null ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : item.stockQuantity > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                                    {item.stockQuantity == null ? 'Unlimited' : item.stockQuantity > 0 ? `${item.stockQuantity} in stock` : 'Out of stock'}
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.description}</p>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={openCreate}
                className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-interactive hover:scale-105 flex items-center justify-center"
                aria-label="Add merch item"
            >
                <Icon name="add" className="text-2xl" />
            </button>
        </div>
    );
};

export default MerchTab;
