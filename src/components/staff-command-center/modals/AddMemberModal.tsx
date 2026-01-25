import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../Toast';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[\d\s\-\+\(\)\.]+$/;

export const AddMemberModal: React.FC<AddUserModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { showToast } = useToast();
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const validateFirstName = (value: string): string | undefined => {
    if (!value.trim()) return 'First name is required';
    if (value.trim().length > 50) return 'First name must be 50 characters or less';
    return undefined;
  };

  const validateLastName = (value: string): string | undefined => {
    if (!value.trim()) return 'Last name is required';
    if (value.trim().length > 50) return 'Last name must be 50 characters or less';
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) return 'Email is required';
    if (!EMAIL_REGEX.test(value)) return 'Please enter a valid email address';
    if (value.length > 255) return 'Email must be 255 characters or less';
    return undefined;
  };

  const validatePhone = (value: string): string | undefined => {
    if (!value.trim()) return undefined;
    if (!PHONE_REGEX.test(value)) return 'Please enter a valid phone number';
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length < 10) return 'Phone number must have at least 10 digits';
    if (digitsOnly.length > 15) return 'Phone number is too long';
    return undefined;
  };

  const validateAllFields = (): FieldErrors => {
    return {
      firstName: validateFirstName(firstName),
      lastName: validateLastName(lastName),
      email: validateEmail(email),
      phone: validatePhone(phone)
    };
  };

  const hasErrors = (errors: FieldErrors): boolean => {
    return Object.values(errors).some(e => e !== undefined);
  };

  const resetForm = useCallback(() => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setError(null);
    setFieldErrors({});
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  const handleFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFirstName(value);
    if (fieldErrors.firstName) {
      setFieldErrors(prev => ({ ...prev, firstName: validateFirstName(value) }));
    }
  };

  const handleLastNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLastName(value);
    if (fieldErrors.lastName) {
      setFieldErrors(prev => ({ ...prev, lastName: validateLastName(value) }));
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    if (fieldErrors.email) {
      setFieldErrors(prev => ({ ...prev, email: validateEmail(value) }));
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPhone(value);
    if (fieldErrors.phone) {
      setFieldErrors(prev => ({ ...prev, phone: validatePhone(value) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const errors = validateAllFields();
    setFieldErrors(errors);
    
    if (hasErrors(errors)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          visitorType: 'NEW',
          dataSource: 'APP',
          createStripeCustomer: true
        })
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`${firstName.trim()} ${lastName.trim()} added successfully`, 'success');
        onSuccess?.();
        onClose();
      } else {
        const data = await res.json();
        if (res.status === 409) {
          setError(`This email already exists in the system. Check the directory for ${data.existingUser?.name || email}.`);
        } else {
          setError(data.error || 'Failed to add user');
        }
      }
    } catch (err) {
      setError('Failed to add user');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <>
      <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-modal-backdrop" style={{ zIndex: 'var(--z-modal)' }}>
        <div className="w-full max-w-md bg-white dark:bg-[#1a1d12] rounded-2xl shadow-2xl border border-primary/20 dark:border-white/10 overflow-hidden animate-modal-slide-up">
          <div className="px-6 py-4 border-b border-primary/10 dark:border-white/10 bg-primary/5 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined">person_add</span>
                New User
              </h2>
              <button onClick={onClose} className="p-1 hover:bg-primary/10 dark:hover:bg-white/10 rounded-lg">
                <span className="material-symbols-outlined text-primary/60 dark:text-white/60">close</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-primary dark:text-white mb-2">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={handleFirstNameChange}
                    placeholder="John"
                    className={`w-full px-4 py-2 border rounded-xl bg-white dark:bg-black/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 ${
                      fieldErrors.firstName ? 'border-red-500' : 'border-primary/20 dark:border-white/20'
                    }`}
                  />
                  {fieldErrors.firstName && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-primary dark:text-white mb-2">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={handleLastNameChange}
                    placeholder="Smith"
                    className={`w-full px-4 py-2 border rounded-xl bg-white dark:bg-black/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 ${
                      fieldErrors.lastName ? 'border-red-500' : 'border-primary/20 dark:border-white/20'
                    }`}
                  />
                  {fieldErrors.lastName && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.lastName}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-primary dark:text-white mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  placeholder="john@example.com"
                  className={`w-full px-4 py-2 border rounded-xl bg-white dark:bg-black/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 ${
                    fieldErrors.email ? 'border-red-500' : 'border-primary/20 dark:border-white/20'
                  }`}
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-primary dark:text-white mb-2">
                  Phone <span className="text-primary/50 dark:text-white/50">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="+1 (555) 123-4567"
                  className={`w-full px-4 py-2 border rounded-xl bg-white dark:bg-black/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 ${
                    fieldErrors.phone ? 'border-red-500' : 'border-primary/20 dark:border-white/20'
                  }`}
                />
                {fieldErrors.phone && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.phone}</p>
                )}
              </div>

              <p className="text-xs text-primary/50 dark:text-white/50">
                This person will be added to the Visitors tab. You can send them a payment link from their profile to convert them to a member.
              </p>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl">
                  <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">error</span>
                    {error}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-primary/10 dark:border-white/10 bg-primary/5 dark:bg-white/5">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">person_add</span>
                      Add User
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
};

export default AddMemberModal;
