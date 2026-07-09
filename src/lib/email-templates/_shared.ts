// Shared inline styles for all IZISuivis email templates.
// Keep dark-safe (Body always white); brand accent = slate/indigo.
export const styles = {
  main: { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' },
  container: { padding: '24px', maxWidth: '560px', margin: '0 auto' },
  h1: { fontSize: '22px', color: '#0f172a', margin: '0 0 16px' },
  text: { fontSize: '15px', color: '#334155', lineHeight: '22px', margin: '4px 0' },
  card: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginTop: '16px' },
  label: { fontSize: '11px', textTransform: 'uppercase' as const, color: '#64748b', margin: '8px 0 2px', letterSpacing: '0.5px' },
  value: { fontSize: '15px', color: '#0f172a', margin: 0, fontWeight: 500 },
  button: { background: '#0f172a', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', fontSize: '14px', fontWeight: 600 },
  buttonSecondary: { background: '#ffffff', color: '#0f172a', padding: '11px 19px', borderRadius: '6px', textDecoration: 'none', fontSize: '14px', fontWeight: 600, border: '1px solid #cbd5e1' },
  hr: { borderTop: '1px solid #e2e8f0', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#94a3b8', textAlign: 'center' as const },
  callout: { fontSize: '14px', color: '#0f172a', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '8px', padding: '12px 14px', margin: '14px 0' },
  warning: { fontSize: '14px', color: '#7c2d12', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px 14px', margin: '14px 0' },
  success: { fontSize: '14px', color: '#065f46', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '12px 14px', margin: '14px 0' },
} as const;
