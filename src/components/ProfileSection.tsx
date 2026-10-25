import { Save, X } from 'lucide-react';

export function EditorActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="profile-actions">
      <button type="submit" className="profile-button profile-button-primary" disabled={busy}>
        <Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="profile-button" onClick={onCancel} disabled={busy}>
        <X size={16} aria-hidden="true" />Cancel
      </button>
    </div>
  );
}
