// Clip-art catalogue: the custom safety/electrical set plus the full Lucide
// icon set (ISC licence), loaded lazily and grouped into categories.

import { CUSTOM_BY_ID, CUSTOM_SYMBOLS } from './custom';

type IconNode = [string, Record<string, string>][];

export interface ClipArtItem {
  key: string; // "custom:w012" | "lucide:zap"
  name: string;
  category: string;
  tags: string[];
}

export const CATEGORIES = [
  'Safety',
  'Electrical',
  'Network & IT',
  'Office',
  'Home',
  'Tools',
  'Shapes',
  'Arrows',
  'Signs & Symbols',
  'Transport',
  'Nature & Weather',
  'Food',
  'People',
  'Media',
  'Other',
] as const;

// Lucide name -> category rules, first match wins.
const RULES: [string, RegExp][] = [
  ['Safety', /^(shield|triangle-alert|octagon-alert|circle-alert|siren|hard-hat|flame|fire-extinguisher|cross|hospital|biohazard|radiation|skull|construction|cone|traffic-cone|lock|lock-keyhole|key|ban|hand)/],
  ['Electrical', /^(zap|plug|power|battery|cable|lightbulb|lamp|bolt|unplug|sun-medium|solar|fan|heater|air-vent|thermometer|gauge|cpu|microchip|circuit|electric|outlet|toggle|ev-|fuel|heat|snowflake|refrigerator|washing|microwave|oven|cooking-pot)/],
  ['Network & IT', /^(wifi|router|server|network|ethernet|database|hard-drive|monitor|laptop|computer|keyboard|mouse|printer|smartphone|tablet|tv|cloud|usb|bluetooth|radio|satellite|antenna|cast|webcam|cctv|cpu|memory|binary|code|terminal|hdmi|rss|signal|scan|qr|barcode|nfc|sim|disc|save|file-code|git|globe|link)/],
  ['Office', /^(file|folder|clipboard|paperclip|pen|pencil|printer|calendar|book|briefcase|archive|inbox|mail|notebook|sticky|stamp|ruler|scissors|calculator|presentation|chart|receipt|id-card|contact|phone|badge|bookmark|library|landmark|building|newspaper|square-pen|signature|tag|tags|package|box|boxes|container)/],
  ['Home', /^(house|home|bed|bath|sofa|armchair|lamp|door|fence|warehouse|tent|blinds|shower|toilet|sink|key|refrigerator|washing|microwave|oven|cooking|utensils|coffee|cup|wine|baby|dog|cat|bird|fish|rabbit|flower|sprout|trees|tree|leaf|shovel|lawn|heater|fan)/],
  ['Tools', /^(wrench|hammer|drill|screwdriver|axe|pickaxe|shovel|saw|ruler|paintbrush|paint|brush|pipette|magnet|tool|settings|cog|nut|bolt|hard-hat|construction|anvil|ladder|scale|scissors|ruler)/],
  ['Shapes', /^(circle|square|triangle|diamond|hexagon|octagon|pentagon|star|heart|cylinder|cone|cuboid|torus|pyramid|shapes|spline|rectangle|squircle|blob)/],
  ['Arrows', /^(arrow|chevron|move|corner|undo|redo|refresh|rotate|repeat|shuffle|trending|log-in|log-out|import|download|upload|expand|shrink|maximize|minimize)/],
  ['Signs & Symbols', /^(info|help|badge|check|x|plus|minus|equal|percent|asterisk|hash|at-sign|ampersand|euro|pound|dollar|currency|copyright|accessibility|recycle|infinity|sigma|pi|omega|parking|ticket|wheelchair|baby|toilet|accessibility|cigarette|dog|anchor|flag|crosshair|target|locate|map-pin|navigation|compass|signpost|milestone)/],
  ['Transport', /^(car|bus|truck|bike|train|tram|plane|ship|sailboat|rocket|tractor|forklift|caravan|ambulance|motorbike|scooter|fuel|parking|road|traffic|container|anchor|helicopter|cable-car)/],
  ['Nature & Weather', /^(sun|moon|cloud|snowflake|wind|droplet|droplets|waves|umbrella|rainbow|thermometer|mountain|tree|trees|leaf|flower|sprout|clover|cherry|bug|flame|earth|globe|tornado|haze|rainbow|feather)/],
  ['Food', /^(apple|banana|beef|beer|cake|candy|carrot|cherry|citrus|coffee|cookie|croissant|cup|dessert|drumstick|egg|fish|grape|ham|ice-cream|milk|nut|pizza|popcorn|salad|sandwich|soup|utensils|wheat|wine|cooking|chef|bottle|glass|martini|lollipop|vegan|hamburger|cup-soda)/],
  ['People', /^(user|users|person|baby|accessibility|contact|hand|smile|frown|meh|laugh|angry|annoyed|brain|ear|eye|footprints|heart-handshake|handshake|venus|mars|bone|skull)/],
  ['Media', /^(play|pause|music|volume|video|film|camera|image|mic|headphones|speaker|disc|radio|tv|clapperboard|gamepad|joystick|dice|puzzle|palette|guitar|piano|drum|podcast|audio)/],
];

function categorise(name: string): string {
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return 'Other';
}

let lucideNodes: Record<string, IconNode> | null = null;
let lucideTags: Record<string, string[]> | null = null;
let catalog: ClipArtItem[] | null = null;
let loading: Promise<ClipArtItem[]> | null = null;

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function customCatalog(): ClipArtItem[] {
  return CUSTOM_SYMBOLS.map((s) => ({ key: `custom:${s.id}`, name: s.name, category: s.category, tags: s.tags }));
}

export function loadCatalog(): Promise<ClipArtItem[]> {
  if (catalog) return Promise.resolve(catalog);
  loading ??= (async () => {
    const [nodes, tags] = await Promise.all([
      import('lucide-static/icon-nodes.json').then((m) => m.default as unknown as Record<string, IconNode>),
      import('lucide-static/tags.json').then((m) => m.default as unknown as Record<string, string[]>),
    ]);
    lucideNodes = nodes;
    lucideTags = tags;
    const items: ClipArtItem[] = customCatalog();
    for (const name of Object.keys(nodes)) {
      items.push({ key: `lucide:${name}`, name: titleCase(name), category: categorise(name), tags: lucideTags[name] ?? [] });
    }
    catalog = items;
    return items;
  })();
  return loading;
}

export function isCatalogLoaded() {
  return !!lucideNodes;
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** SVG markup for a clip-art key, or null if not (yet) available. */
export function symbolSvg(key: string, strokeWidth?: number): string | null {
  const [src, id] = key.split(':');
  if (src === 'custom') return CUSTOM_BY_ID.get(id)?.svg ?? null;
  if (src === 'lucide') {
    const node = lucideNodes?.[id];
    if (!node) return null;
    const inner = node
      .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(String(v))}"`).join(' ')}/>`)
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  return null;
}

export function needsCatalog(key: string) {
  return key.startsWith('lucide:') && !lucideNodes;
}

export function symbolName(key: string): string {
  const [src, id] = key.split(':');
  if (src === 'custom') return CUSTOM_BY_ID.get(id)?.name ?? id;
  return titleCase(id ?? key);
}
