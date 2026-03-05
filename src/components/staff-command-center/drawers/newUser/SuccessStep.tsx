import React from 'react';

interface SuccessStepProps {
  isDark: boolean;
  createdUser: { id: string; email: string; name: string } | null;
  onClose: () => void;
}

export function SuccessStep({ isDark, createdUser, onClose }: SuccessStepProps) {
  return (
    <div className="text-center py-8">
      <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
        isDark ? 'bg-emerald-600/20' : 'bg-emerald-100'
      }`}>
        <span className="material-symbols-outlined text-3xl text-emerald-600">check_circle</span>
      </div>
      <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Member Created!
      </h3>
      <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {createdUser?.name} has been added successfully.
      </p>
      <button
        onClick={onClose}
        className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors tactile-btn"
      >
        Done
      </button>
    </div>
  );
}
