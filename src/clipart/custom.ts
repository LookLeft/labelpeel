// Monochrome safety and electrical symbols drawn for label printing.
// Safety signs follow the ISO 7010 shapes (warning triangle, prohibition
// circle, mandatory disc, safe-condition square); electrical symbols follow
// IEC 60417 / IEC 60617 conventions. All use currentColor so they can be
// recoloured or inverted. viewBox is 0 0 100 100.

export interface CustomSymbol {
  id: string;
  name: string;
  category: string;
  tags: string[];
  svg: string;
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor">${body}</svg>`;
const stroke = (body: string, w = 5) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// --- glyphs (drawn in a 100 grid, centred around 50,55 for triangles) ---
const G = {
  exclaim: '<rect x="45" y="36" width="10" height="27" rx="4"/><circle cx="50" cy="71" r="5.5"/>',
  bolt: '<path d="M58 30 L38 58 H50 L43 82 L65 51 H53 L61 30 Z"/>',
  flame:
    '<path d="M50 32 C60 44 67 51 65 63 C63.5 72 57 78 50 78 C42 78 35 72 35 63 C35 55 41 50 44 42 C46 49 48 53 52 55 C54 48 53 40 50 32 Z"/>',
  hot: '<path d="M38 40 c-5 6 5 10 0 17 M50 40 c-5 6 5 10 0 17 M62 40 c-5 6 5 10 0 17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="30" y="66" width="40" height="5" rx="2"/>',
  battery: '<rect x="33" y="42" width="34" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="5"/><rect x="41" y="36" width="6" height="6"/><rect x="53" y="36" width="6" height="6"/><path d="M52 47 L44 58 H50 L47 67 L56 55 H50 Z"/>',
  magnet: '<path d="M36 40 V58 A14 14 0 0 0 64 58 V40" fill="none" stroke="currentColor" stroke-width="9"/><rect x="31.5" y="36" width="9" height="7" fill="#fff"/>',
  plug: '<rect x="38" y="40" width="24" height="18" rx="3"/><rect x="42" y="28" width="5" height="13" rx="1"/><rect x="53" y="28" width="5" height="13" rx="1"/><rect x="46" y="57" width="8" height="10"/><rect x="48" y="66" width="4" height="10"/>',
  book: '<path d="M27 32 H47 C50 32 50 34 50 36 V72 C50 69 48 68 45 68 H27 Z M73 32 H53 C50 32 50 34 50 36 V72 C50 69 52 68 55 68 H73 Z"/>',
  goggles:
    '<path d="M24 46 C24 40 30 38 36 38 H64 C70 38 76 40 76 46 V54 C76 60 70 62 64 62 H58 L53 55 H47 L42 62 H36 C30 62 24 60 24 54 Z"/>',
  hardhat:
    '<path d="M26 62 C26 46 36 36 50 36 C64 36 74 46 74 62 Z"/><rect x="20" y="62" width="60" height="7" rx="3"/>',
  padlock:
    '<path d="M38 48 V40 A12 12 0 0 1 62 40 V48" fill="none" stroke="currentColor" stroke-width="7"/><rect x="31" y="47" width="38" height="30" rx="4"/>',
  cross: '<rect x="41" y="26" width="18" height="48"/><rect x="26" y="41" width="48" height="18"/>',
  extinguisher:
    '<rect x="38" y="36" width="20" height="44" rx="6"/><rect x="43" y="28" width="10" height="9"/><path d="M53 31 H66 L72 40" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  cigarette:
    '<rect x="22" y="56" width="44" height="9"/><rect x="68" y="56" width="10" height="9"/><path d="M72 50 c-4 -5 4 -8 0 -14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
  toggle:
    '<rect x="34" y="28" width="32" height="44" rx="5" fill="none" stroke="currentColor" stroke-width="5"/><rect x="42" y="36" width="16" height="16" rx="2"/>',
  person:
    '<circle cx="50" cy="30" r="7"/><path d="M41 42 H59 L62 62 H56 L55 78 H45 L44 62 H38 Z"/>',
  hand:
    '<path d="M40 76 L32 56 C30 52 35 49 38 52 L42 58 V34 C42 30 48 30 48 34 V52 V30 C48 26 54 26 54 30 V52 V33 C54 29 60 29 60 33 V54 V39 C60 35 66 35 66 39 V62 C66 70 62 76 56 76 Z"/>',
  water: '<path d="M50 30 C58 44 64 52 64 61 A14 14 0 0 1 36 61 C36 52 42 44 50 30 Z"/>',
};

const warning = (glyph: string) =>
  svg(`<path fill-rule="evenodd" d="M50 5 C52.5 5 54 6.5 55.5 9 L96 82 C98 86 96 90 91.5 90 H8.5 C4 90 2 86 4 82 L44.5 9 C46 6.5 47.5 5 50 5 Z M50 21 L16 82 H84 Z"/><g transform="translate(0 6) scale(1) ">${glyph}</g>`);

const prohibition = (glyph: string) =>
  svg(`<g transform="translate(50 50) scale(0.82) translate(-50 -52)">${glyph}</g><path fill-rule="evenodd" d="M50 4 A46 46 0 1 1 49.99 4 Z M50 14 A36 36 0 1 0 50.01 14 Z"/><rect x="45" y="6" width="10" height="88" transform="rotate(-45 50 50)"/>`);

const masked = (shape: string, glyph: string, id: string) =>
  svg(`<defs><mask id="${id}"><rect width="100" height="100" fill="#fff"/><g fill="#000" stroke="#000">${glyph.replace(/currentColor/g, '#000')}</g></mask></defs><g mask="url(#${id})">${shape}</g>`);
const mandatory = (glyph: string, id: string) => masked('<circle cx="50" cy="50" r="47"/>', `<g transform="translate(0 -3)">${glyph}</g>`, id);
const safe = (glyph: string, id: string) => masked('<rect x="3" y="3" width="94" height="94" rx="6"/>', `<g transform="translate(0 -3)">${glyph}</g>`, id);

export const CUSTOM_SYMBOLS: CustomSymbol[] = [
  // Warning (ISO 7010 W-series)
  { id: 'w001', name: 'General warning', category: 'Safety', tags: ['warning', 'caution', 'danger', 'w001', 'exclamation'], svg: warning(G.exclaim) },
  { id: 'w012', name: 'Electricity warning', category: 'Safety', tags: ['warning', 'electric', 'shock', 'voltage', 'danger', 'w012', 'bolt'], svg: warning(G.bolt) },
  { id: 'w021', name: 'Flammable', category: 'Safety', tags: ['warning', 'fire', 'flammable', 'w021'], svg: warning(G.flame) },
  { id: 'w017', name: 'Hot surface', category: 'Safety', tags: ['warning', 'hot', 'heat', 'w017'], svg: warning(G.hot) },
  { id: 'w026', name: 'Battery charging', category: 'Safety', tags: ['warning', 'battery', 'charging', 'w026'], svg: warning(G.battery) },
  { id: 'w006', name: 'Magnetic field', category: 'Safety', tags: ['warning', 'magnet', 'magnetic', 'w006'], svg: warning(G.magnet.replace('fill="#fff"', 'fill="none"')) },
  // Prohibition
  { id: 'p001', name: 'General prohibition', category: 'Safety', tags: ['prohibited', 'no', 'forbidden', 'p001'], svg: prohibition('') },
  { id: 'p002', name: 'No smoking', category: 'Safety', tags: ['no smoking', 'prohibited', 'p002'], svg: prohibition(G.cigarette) },
  { id: 'p003', name: 'No open flame', category: 'Safety', tags: ['no fire', 'flame', 'prohibited', 'p003'], svg: prohibition(G.flame) },
  { id: 'p031', name: 'Do not switch', category: 'Safety', tags: ['do not switch on', 'do not operate', 'prohibited', 'p031', 'switch'], svg: prohibition(G.toggle) },
  { id: 'p010', name: 'Do not touch', category: 'Safety', tags: ['do not touch', 'hand', 'prohibited', 'p010'], svg: prohibition(G.hand) },
  { id: 'p-water', name: 'No water', category: 'Safety', tags: ['no water', 'prohibited', 'extinguish'], svg: prohibition(G.water) },
  // Mandatory
  { id: 'm001', name: 'General mandatory', category: 'Safety', tags: ['mandatory', 'must', 'm001'], svg: mandatory(G.exclaim.replace('y="36"', 'y="26"').replace('cy="71"', 'cy="66"'), 'm001') },
  { id: 'm021', name: 'Disconnect before work', category: 'Safety', tags: ['mandatory', 'disconnect', 'unplug', 'isolate', 'm021', 'plug'], svg: mandatory(G.plug, 'm021') },
  { id: 'm002', name: 'Read the manual', category: 'Safety', tags: ['mandatory', 'manual', 'instructions', 'm002', 'book'], svg: mandatory(G.book, 'm002') },
  { id: 'm004', name: 'Wear eye protection', category: 'Safety', tags: ['mandatory', 'goggles', 'eye', 'ppe', 'm004'], svg: mandatory(G.goggles, 'm004') },
  { id: 'm014', name: 'Wear head protection', category: 'Safety', tags: ['mandatory', 'hard hat', 'helmet', 'ppe', 'm014'], svg: mandatory(G.hardhat, 'm014') },
  { id: 'm-lock', name: 'Lock out', category: 'Safety', tags: ['mandatory', 'lock out', 'loto', 'isolate', 'padlock'], svg: mandatory(G.padlock, 'mlock') },
  // Safe condition / fire
  { id: 'e003', name: 'First aid', category: 'Safety', tags: ['first aid', 'safe', 'e003', 'medical', 'cross'], svg: safe(G.cross, 'e003') },
  { id: 'f001', name: 'Fire extinguisher', category: 'Safety', tags: ['fire', 'extinguisher', 'f001'], svg: safe(G.extinguisher, 'f001') },
  { id: 'e-person', name: 'Authorised person', category: 'Safety', tags: ['person', 'authorised', 'staff'], svg: safe(G.person, 'eperson') },

  // Electrical (IEC 60417 / 60617)
  { id: 'earth', name: 'Earth (ground)', category: 'Electrical', tags: ['earth', 'ground', '5017', 'gnd'], svg: stroke('<path d="M50 12 V52 M22 52 H78 M32 65 H68 M42 78 H58"/>', 6) },
  { id: 'protective-earth', name: 'Protective earth', category: 'Electrical', tags: ['earth', 'protective', 'pe', '5019', 'ground'], svg: stroke('<circle cx="50" cy="50" r="43"/><path d="M50 18 V48 M28 48 H72 M36 60 H64 M44 72 H56"/>', 5) },
  { id: 'chassis', name: 'Frame / chassis', category: 'Electrical', tags: ['chassis', 'frame', '5020', 'earth'], svg: stroke('<path d="M50 14 V52 M22 52 H78 M30 52 L20 70 M50 52 L40 70 M70 52 L60 70"/>', 6) },
  { id: 'equipotential', name: 'Equipotential bonding', category: 'Electrical', tags: ['bonding', 'equipotential', '5021'], svg: stroke('<path d="M50 12 V44 M24 44 H76 L50 82 Z"/>', 6) },
  { id: 'class2', name: 'Class II (double insulated)', category: 'Electrical', tags: ['double insulated', 'class ii', '5172'], svg: stroke('<rect x="10" y="10" width="80" height="80"/><rect x="30" y="30" width="40" height="40"/>', 6) },
  { id: 'class3', name: 'Class III (SELV)', category: 'Electrical', tags: ['selv', 'class iii', 'low voltage', '5180'], svg: svg('<path fill-rule="evenodd" d="M50 4 L96 50 L50 96 L4 50 Z M50 15 L15 50 L50 85 L85 50 Z"/><rect x="36" y="36" width="6" height="28"/><rect x="47" y="36" width="6" height="28"/><rect x="58" y="36" width="6" height="28"/>') },
  { id: 'ac', name: 'Alternating current', category: 'Electrical', tags: ['ac', 'alternating', 'sine', '~'], svg: stroke('<path d="M8 50 C20 18 36 18 50 50 C64 82 80 82 92 50"/>', 7) },
  { id: 'dc', name: 'Direct current', category: 'Electrical', tags: ['dc', 'direct current'], svg: stroke('<path d="M10 38 H90 M10 62 H26 M42 62 H58 M74 62 H90"/>', 7) },
  { id: 'acdc', name: 'AC/DC', category: 'Electrical', tags: ['ac', 'dc', 'both'], svg: stroke('<path d="M10 30 H90 M10 50 H24 M43 50 H57 M76 50 H90 M10 76 C22 60 34 60 50 76 C66 92 78 92 90 76"/>', 6) },
  { id: 'fuse', name: 'Fuse', category: 'Electrical', tags: ['fuse'], svg: stroke('<rect x="22" y="36" width="56" height="28"/><path d="M6 50 H94"/>', 5) },
  { id: 'breaker', name: 'Circuit breaker', category: 'Electrical', tags: ['breaker', 'mcb', 'circuit breaker'], svg: stroke('<path d="M6 60 H32 L64 36 M68 60 H94 M62 54 L74 66 M74 54 L62 66"/>', 5) },
  { id: 'switch', name: 'Switch (open)', category: 'Electrical', tags: ['switch', 'isolator', 'contact'], svg: stroke('<path d="M6 60 H30 L66 36 M70 60 H94"/><circle cx="30" cy="60" r="3"/><circle cx="70" cy="60" r="3"/>', 5) },
  { id: 'isolator', name: 'Isolator', category: 'Electrical', tags: ['isolator', 'disconnector', 'switch'], svg: stroke('<path d="M6 60 H30 L66 36 M70 52 V68 M70 60 H94"/>', 5) },
  { id: 'battery-sym', name: 'Battery', category: 'Electrical', tags: ['battery', 'cell', 'dc'], svg: stroke('<path d="M6 50 H40 M60 50 H94 M40 22 V78 M60 36 V64" /><path d="M22 28 H30 M26 24 V32 M70 28 H78" stroke-width="4"/>', 6) },
  { id: 'resistor', name: 'Resistor', category: 'Electrical', tags: ['resistor'], svg: stroke('<rect x="26" y="38" width="48" height="24"/><path d="M6 50 H26 M74 50 H94"/>', 5) },
  { id: 'capacitor', name: 'Capacitor', category: 'Electrical', tags: ['capacitor'], svg: stroke('<path d="M6 50 H42 M58 50 H94 M42 24 V76 M58 24 V76"/>', 6) },
  { id: 'inductor', name: 'Inductor', category: 'Electrical', tags: ['inductor', 'coil'], svg: stroke('<path d="M6 56 H18 A8 8 0 0 1 34 56 A8 8 0 0 1 50 56 A8 8 0 0 1 66 56 A8 8 0 0 1 82 56 H94"/>', 5) },
  { id: 'diode', name: 'Diode', category: 'Electrical', tags: ['diode', 'rectifier'], svg: svg('<path d="M32 28 L66 50 L32 72 Z"/><rect x="66" y="28" width="6" height="44"/><rect x="6" y="47.5" width="28" height="5"/><rect x="70" y="47.5" width="24" height="5"/>') },
  { id: 'led', name: 'LED', category: 'Electrical', tags: ['led', 'light emitting diode'], svg: svg('<path d="M26 34 L56 52 L26 70 Z"/><rect x="56" y="34" width="5" height="36"/><rect x="6" y="49.5" width="22" height="5"/><rect x="59" y="49.5" width="35" height="5"/><path d="M60 28 L74 14 M68 34 L82 20" stroke="currentColor" stroke-width="4"/><path d="M76 12 L70 14 L74 18 Z M84 18 L78 20 L82 24 Z"/>') },
  { id: 'lamp', name: 'Lamp', category: 'Electrical', tags: ['lamp', 'light', 'luminaire'], svg: stroke('<circle cx="50" cy="50" r="30"/><path d="M29 29 L71 71 M71 29 L29 71 M6 50 H20 M80 50 H94"/>', 5) },
  { id: 'motor', name: 'Motor', category: 'Electrical', tags: ['motor', 'm'], svg: stroke('<circle cx="50" cy="50" r="40"/><path d="M32 66 V34 L50 54 L68 34 V66"/>', 6) },
  { id: 'generator', name: 'Generator', category: 'Electrical', tags: ['generator', 'alternator', 'g'], svg: stroke('<circle cx="50" cy="50" r="40"/><path d="M26 50 C34 34 42 34 50 50 C58 66 66 66 74 50"/>', 6) },
  { id: 'transformer', name: 'Transformer', category: 'Electrical', tags: ['transformer'], svg: stroke('<circle cx="38" cy="50" r="26"/><circle cx="62" cy="50" r="26"/>', 5) },
  { id: 'uk-socket', name: 'UK socket (BS 1363)', category: 'Electrical', tags: ['socket', 'outlet', 'uk', 'bs1363', 'power'], svg: svg('<path fill-rule="evenodd" d="M16 6 H84 A10 10 0 0 1 94 16 V84 A10 10 0 0 1 84 94 H16 A10 10 0 0 1 6 84 V16 A10 10 0 0 1 16 6 Z M16 13 A3 3 0 0 0 13 16 V84 A3 3 0 0 0 16 87 H84 A3 3 0 0 0 87 84 V16 A3 3 0 0 0 84 13 Z"/><rect x="45" y="22" width="10" height="20" rx="1.5"/><rect x="24" y="58" width="20" height="10" rx="1.5"/><rect x="56" y="58" width="20" height="10" rx="1.5"/>') },
  { id: 'eu-socket', name: 'Schuko socket', category: 'Electrical', tags: ['socket', 'outlet', 'eu', 'schuko', 'power'], svg: svg('<path fill-rule="evenodd" d="M50 4 A46 46 0 1 1 49.99 4 Z M50 12 A38 38 0 1 0 50.01 12 Z"/><circle cx="34" cy="50" r="6"/><circle cx="66" cy="50" r="6"/><rect x="44" y="14" width="12" height="8"/><rect x="44" y="78" width="12" height="8"/>') },
  { id: 'iec-socket', name: 'Socket outlet (IEC)', category: 'Electrical', tags: ['socket', 'outlet', 'iec'], svg: stroke('<path d="M22 66 A28 28 0 0 1 78 66 M50 66 V92 M50 38 V8"/>', 6) },
  { id: 'switch-sym', name: 'Light switch', category: 'Electrical', tags: ['switch', 'light switch'], svg: stroke('<circle cx="40" cy="60" r="10"/><path d="M47 53 L80 20 M80 20 L90 30"/>', 6) },
  { id: 'hv', name: 'High voltage', category: 'Electrical', tags: ['high voltage', 'bolt', 'lightning', 'danger'], svg: svg('<path d="M62 4 L22 56 H46 L34 96 L80 38 H56 L70 4 Z"/>') },
  { id: 'solar', name: 'Solar PV', category: 'Electrical', tags: ['solar', 'pv', 'photovoltaic', 'panel'], svg: svg('<path fill-rule="evenodd" d="M14 44 H86 L96 90 H4 Z M21 50 L18 64 H33 L35 50 Z M41 50 L40 64 H60 L59 50 Z M65 50 L67 64 H82 L79 50 Z M16 70 L13 84 H31 L32 70 Z M39 70 L38 84 H62 L61 70 Z M68 70 L69 84 H87 L84 70 Z"/><circle cx="50" cy="22" r="9"/><path d="M50 4 V9 M50 35 V40 M32 22 H37 M63 22 H68 M37 9 L40.5 12.5 M63 9 L59.5 12.5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>') },
  { id: 'ev', name: 'EV charging', category: 'Electrical', tags: ['ev', 'electric vehicle', 'charger', 'car'], svg: svg('<path fill-rule="evenodd" d="M18 46 L26 26 C28 21 31 20 36 20 H64 C69 20 72 21 74 26 L82 46 C88 47 90 50 90 56 V74 H82 V82 H70 V74 H30 V82 H18 V74 H10 V56 C10 50 12 47 18 46 Z M30 28 L25 44 H75 L70 28 Z M20 54 A5 5 0 1 0 20.01 54 Z M80 54 A5 5 0 1 0 80.01 54 Z"/><path d="M53 48 L42 62 H50 L46 72 L58 58 H50 Z" fill="#fff"/>') },
  { id: 'meter', name: 'Meter', category: 'Electrical', tags: ['meter', 'kwh', 'energy'], svg: stroke('<rect x="10" y="16" width="80" height="68" rx="6"/><rect x="22" y="28" width="56" height="18"/><path d="M28 62 H40 M48 62 H52 M60 62 H72"/>', 5) },
  { id: 'rcd', name: 'RCD test button', category: 'Electrical', tags: ['rcd', 'test', 'residual current'], svg: svg('<path fill-rule="evenodd" d="M50 6 A44 44 0 1 1 49.99 6 Z M50 14 A36 36 0 1 0 50.01 14 Z"/><path d="M30 42 H70 V50 H54 V72 H46 V50 H30 Z"/>') },
  { id: 'arrow-feed', name: 'Supply arrow', category: 'Electrical', tags: ['supply', 'incoming', 'feed', 'arrow'], svg: svg('<path d="M10 42 H62 V26 L92 50 L62 74 V58 H10 Z"/>') },
];

export const CUSTOM_BY_ID = new Map(CUSTOM_SYMBOLS.map((s) => [s.id, s]));
