import {
  Type, Layers, Cable, Flag, Flame, EthernetPort, Rows4, PanelTop, LayoutPanelLeft, TriangleAlert, QrCode, ClipboardCheck, Tag,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Type, Layers, Cable, Flag, Flame, EthernetPort, Rows4, PanelTop, LayoutPanelLeft, TriangleAlert, QrCode, ClipboardCheck,
};

export function TypeIcon({ name, size = 18 }: { name: string; size?: number }) {
  const I = ICONS[name] ?? Tag;
  return <I size={size} />;
}
