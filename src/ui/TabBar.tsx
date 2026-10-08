import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useEditor } from '../state/store';
import { closeTab } from './actions';

/** Open labels. The active tab's name and unsaved state are live; others come from their saved entries. */
export function TabBar() {
  const tabs = useEditor((s) => s.tabs);
  const active = useEditor((s) => s.activeTab);
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor((s) => s.dirty);
  const st = useEditor.getState;
  // Double-click a tab to rename its label in place.
  const [renaming, setRenaming] = useState<string | null>(null);
  const finishRename = (value: string | null) => {
    const next = value?.trim();
    if (next && next !== st().doc.name) st().update((d) => ({ ...d, name: next }), 'name');
    setRenaming(null);
  };

  return (
    <nav className={`tabbar ${tabs.length < 2 ? 'single' : ''}`} aria-label="Open labels">
      <div className="tabbar-tabs" role="tablist">
        {tabs.map((t) => {
          const on = t.id === active;
          const label = (on ? name : t.doc.name) || 'Untitled label';
          const unsaved = on ? dirty : t.dirty;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={on}
              className={`doc-tab ${on ? 'on' : ''}`}
              title={label}
              onClick={() => st().switchTab(t.id)}
              onDoubleClick={() => {
                st().switchTab(t.id);
                setRenaming(t.id);
              }}
              // Middle-click closes, as in browsers.
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            >
              {renaming === t.id && on ? (
                <input
                  className="doc-tab-rename"
                  defaultValue={label}
                  autoFocus
                  aria-label="Label name"
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => finishRename(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') finishRename(e.currentTarget.value);
                    if (e.key === 'Escape') finishRename(null);
                  }}
                />
              ) : (
                <span className="doc-tab-name">{label}</span>
              )}
              {unsaved && <span className="doc-tab-dirty" title="Unsaved changes">●</span>}
              <button
                className="doc-tab-close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn ghost icon sm" title="New label" onClick={() => st().set({ wizardOpen: true })}>
        <Plus size={15} />
      </button>
    </nav>
  );
}
