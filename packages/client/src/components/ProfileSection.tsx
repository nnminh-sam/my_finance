import type { ReactNode } from 'react';
import { Edit2, Save, X } from 'lucide-react';

export function ProfileSection({ id, title, icon, editing, onEdit, wide = false, children }: {
  id: string;
  title: string;
  icon: ReactNode;
  editing: boolean;
  onEdit: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`profile-card glass${wide ? ' profile-card-wide' : ''}`} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="profile-section-heading">
        {editing ? <span className="profile-section-title">{icon}{title}</span> : (
          <button type="button" className="profile-edit-section" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
            <span className="profile-section-title">{icon}{title}</span>
            <span className="profile-edit-label"><Edit2 size={15} aria-hidden="true" />Edit</span>
          </button>
        )}
      </h2>
      {children}
    </section>
  );
}

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
