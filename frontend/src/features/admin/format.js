export const count = (n) => Number(n ?? 0).toLocaleString('en-IN');
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const formatDateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
export const ROLE_LABEL = { admin: 'Admin', user: 'Normal user' };

export function formatAccess(user) {
  if (!user) return { label: '—', sub: '', type: 'none', isExpired: false };
  if (user.accessType === 'lifetime') {
    return { label: 'Lifetime', sub: 'Perpetual access', type: 'lifetime', isExpired: false };
  }
  if (user.accessType === 'days') {
    if (!user.firstLoginAt) {
      return {
        label: `${user.accessDays || 10} days`,
        sub: 'Pending 1st login',
        type: 'pending_days',
        isExpired: false,
      };
    }
    const exp = new Date(user.expiresAt);
    const now = new Date();
    const diffMs = exp - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffMs <= 0 || user.isExpired) {
      return {
        label: 'Expired',
        sub: `Ended ${formatDateOnly(user.expiresAt)}`,
        type: 'expired',
        isExpired: true,
      };
    }
    return {
      label: `${diffDays} day${diffDays === 1 ? '' : 's'} left`,
      sub: `Until ${formatDateOnly(user.expiresAt)}`,
      type: 'active_days',
      isExpired: false,
    };
  }
  if (user.accessType === 'date') {
    const exp = new Date(user.expiresAt);
    const now = new Date();
    const diffMs = exp - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffMs <= 0 || user.isExpired) {
      return {
        label: 'Expired',
        sub: `Ended ${formatDateOnly(user.expiresAt)}`,
        type: 'expired',
        isExpired: true,
      };
    }
    return {
      label: `${diffDays} day${diffDays === 1 ? '' : 's'} left`,
      sub: `Until ${formatDateOnly(user.expiresAt)}`,
      type: 'active_date',
      isExpired: false,
    };
  }
  return { label: 'Lifetime', sub: 'Perpetual access', type: 'lifetime', isExpired: false };
}

