// One-file backup of everything Labelpeel keeps in the browser or app: open
// labels, the "My labels" library and settings. Browser storage can be
// cleared (by the browser, the user, or uninstalling an app), so this is the
// way to keep a copy or move to another browser or device.

import type { LabelDoc } from '../model/types';
import { migrate, useEditor, type Settings } from '../state/store';
import { download, libraryList, libraryPut, pickFile, type LibraryItem } from './files';

const FORMAT = 'labelpeel-backup';

interface Backup {
  app: typeof FORMAT;
  version: 1;
  created: string;
  settings: Partial<Settings>;
  tabs: { doc: LabelDoc; fileName: string | null }[];
  library: LibraryItem[];
}

export async function exportBackup() {
  const s = useEditor.getState();
  // Screen calibration belongs to this screen, not the labels.
  const { screenDevicePxPerMm: _screen, ...settings } = s.settings;
  void _screen;
  const backup: Backup = {
    app: FORMAT,
    version: 1,
    created: new Date().toISOString(),
    settings,
    tabs: s.allTabs().map((t) => ({ doc: t.doc, fileName: t.fileName })),
    library: await libraryList().catch(() => []),
  };
  const day = backup.created.slice(0, 10);
  download(`labelpeel-backup-${day}.json`, JSON.stringify(backup), 'application/json');
  s.notify(`Backed up ${backup.tabs.length} open label${backup.tabs.length === 1 ? '' : 's'} and ${backup.library.length} saved label${backup.library.length === 1 ? '' : 's'}.`, 'success');
}

export async function restoreBackup() {
  const s = useEditor.getState();
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let backup: Backup;
  try {
    backup = JSON.parse(await file.text());
    if (backup?.app !== FORMAT || !Array.isArray(backup.tabs)) throw new Error('not a backup');
  } catch {
    s.notify('That file is not a Labelpeel backup.', 'error');
    return;
  }

  // Saved labels: the same label (same id) is replaced by the backup's copy only if it's newer.
  const existing = new Map((await libraryList().catch(() => [])).map((i) => [i.id, i]));
  let saved = 0;
  for (const item of backup.library ?? []) {
    const cur = existing.get(item.id);
    if (cur && cur.updated >= item.updated) continue;
    await libraryPut({ ...item, doc: migrate(item.doc) });
    saved++;
  }

  // Open labels: open each in a tab, skipping any that are already open unchanged.
  const open = new Set(s.allTabs().map((t) => JSON.stringify(t.doc)));
  let opened = 0;
  for (const t of backup.tabs) {
    const doc = migrate(t.doc);
    if (open.has(JSON.stringify(doc))) continue;
    const cur = useEditor.getState();
    if (cur.pristine) {
      // Fill a blank, untouched tab first, as opening a label does.
      cur.setDoc(doc, { resetHistory: true });
      cur.setFile(t.fileName, null);
      cur.set({ dirty: false, selection: [], pristine: false });
    } else cur.newTab(doc, { name: t.fileName, handle: null });
    opened++;
  }
  if (backup.settings) s.setSettings({ ...backup.settings, screenDevicePxPerMm: s.settings.screenDevicePxPerMm });
  s.notify(`Restored from ${file.name}: opened ${opened} label${opened === 1 ? '' : 's'}, added or updated ${saved} saved label${saved === 1 ? '' : 's'}.`, 'success');
}
