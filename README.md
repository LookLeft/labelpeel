# Labelsmith

A label designer for Brother P-touch printers that runs in the browser and prints directly over Bluetooth or USB. It was built first for the **PT-E560BT** and has profiles for the rest of the PT range.

> Labelsmith is an independent project. It is not affiliated with, endorsed by or sponsored by Brother Industries, Ltd. Brother, P-touch, TZe, HSe and FLe are trademarks of Brother Industries, Ltd.; they and printer model names are used here only to describe compatibility.

It is a static site, so it deploys to GitHub Pages and works offline as an installable app.

## Features

- **Start from what you're labelling.** Choose a label type and the layout is generated from a few settings:
  - general text, self-laminating, cable wrap, cable flag, heat-shrink
  - patch panel, punch-down block, faceplate
  - distribution board, safety sign, asset tag, inspection or test label
- **Distribution boards.** Set the module pitch and how many ways each block takes (for example, a 2-way RCD). You also control:
  - circuit numbers and heavy group dividers
  - horizontal or vertical text, and where the text sits
  - presets for UK 10-way and 20-way consumer units, three-phase, DIN and mixed boards
- **About 50 templates**, grouped into:
  - Electrical (BS 7671 warnings, isolation, RCD test, periodic inspection, dual supply)
  - Distribution boards
  - Safety
  - Network & cables
  - Asset & inspection
  - Office & home
- **Clip art.** Hand-drawn ISO 7010–style warning, prohibition, mandatory and safe-condition signs, plus IEC electrical symbols. Around 1,900 more black and white icons, searchable and grouped by category.
- **Editor.** A canvas you can zoom and pan, with:
  - snapping, multi-select, resize and rotate, align and distribute, layers
  - undo and redo
  - inline text editing with bold, italic and underline, and auto-fit text
  - bundled fonts, your installed system fonts, or a font file you load
- **Tables.** Rows and columns with merged cells, black, hatched or dotted cell fills, and solid, dashed or dotted lines. Double-click a cell to edit it.
- **Frames.** Around the whole label or any part of it: rectangle, rounded, double, thick, dashed, dotted, hazard stripes, brackets, corner marks, cut corners, ticket and tag.
- **Codes.** QR, Data Matrix, Code 128, Code 39, EAN, UPC and others. Modules snap to printer dots so codes scan reliably.
- **Data.** Placeholders such as:
  - `{{date}}`, `{{date+12m}}` and `{{date+1y:MMM YYYY}}`
  - `{{time}}`
  - serial numbers `{{n}}` (with prefix, padding, letters and step)
  - any column from a CSV or pasted spreadsheet
  
  Printing produces one label per record or serial number.
- **Tape and cutting.**
  - 3.5–36 mm TZe, HSe heat-shrink and FLe flag media
  - auto or fixed length, margins, tape and ink colours
  - cut after each label, at the end, or never; half cut; chain printing; mirror
  - copies, and splitting a long design into several labels
- **Preview.** A dot-accurate preview shows exactly what the print head will print. You can also export a PNG or a raw `.bin` print file.
- **Files.** Save, Save As and Open use `.labelsmith` (JSON) files, with a local library of saved labels and autosave.
- **Brother `.lbx` import** (see below).

## Printing

Printing needs Chrome or Edge on desktop, ChromeOS or Android. Firefox and Safari can design labels but can't reach printers.

| Connection | How |
| --- | --- |
| Bluetooth | Pair the printer in your OS settings, then choose **Connect printer → Bluetooth**. This uses Web Serial over Bluetooth Classic RFCOMM and needs Chrome 117 or later. On Windows you can also choose the printer's outgoing COM port. On macOS, pick the port starting with `cu.` (for example `cu.PT-E560BT…`): Chrome's direct Bluetooth link fails to open there. The printer showing "Not Connected" in macOS after pairing is normal. |
| USB | Uses WebUSB. Works on macOS, Linux, ChromeOS and Android. On Windows, Brother's driver holds the device, so use Bluetooth there. On Linux, you may need a udev rule giving access to vendor `04f9`. |

Over USB the printer reports the tape that is loaded, and the app offers to switch your design to match it.

If labels don't print, turn on **Printer → Advanced → Minimal command set**. This sends exactly the byte sequence [ptouch-print](https://git.familie-radermacher.ch/linux/ptouch-print.git) uses, which has been verified on the PT-E560BT. In that mode the printer uses its own cut defaults.

The cut, half-cut and chain commands follow Brother's raster command reference but haven't been tested on hardware yet.

## Can it use Brother's own file format?

Partly. A `.lbx` file from P-touch Editor is a ZIP archive containing:

- `label.xml`, which holds the layout in Brother's own undocumented XML schema
- `prop.xml`
- BMP images

Because the format isn't documented, **File → Import .lbx** imports it on a best-effort basis. It brings in:

- tape size and orientation
- text, images and shapes
- common barcodes

Anything it can't map is listed as a warning after import. The app doesn't write `.lbx`; it saves its own `.labelsmith` format.

## iPhone and iPad

Browsers on iOS can't reach printers, so `ios/` has a small native app that
wraps this one and adds a Bluetooth bridge. See [ios/README.md](ios/README.md).

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # protocol, raster and placeholder tests
npm run build      # type-check and build to dist/
```

The stack is Vite, React, TypeScript and zustand. bwip-js renders barcodes and Lucide supplies the icons.

Main folders:

- `src/printer`: printer protocol, profiles, transports and status parsing
- `src/render`: renders a design to the canvas and to the 1-bit print bitmap
- `src/model`: label types, templates and placeholders

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and tests every push and pull request. Pushes to `main` are also deployed.

To turn on deployment once, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

## Credits

The protocol details come from [ptouch-print](https://git.familie-radermacher.ch/linux/ptouch-print.git), [ptouch-rs](https://github.com/vowstar/ptouch-rs), [ptouch-webapp](https://github.com/the78mole/ptouch-webapp) and Brother's raster command reference. No code from those projects is included; they were used as references for the printer's command protocol. Brother's `.lbx` format is read only so you can import your own files.

Brother, P-touch, TZe, HSe and FLe are trademarks of Brother Industries, Ltd. Labelsmith is not affiliated with Brother.

Third-party open-source licences for everything bundled in the app are collected into `licenses.txt` at build time (`scripts/licenses.mjs`) and shown under **View → About Labelsmith**.
