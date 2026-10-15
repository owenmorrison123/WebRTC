# Portal themes

A theme is the border and surroundings drawn around the other campus's video. Each kiosk picks its own theme: open **Settings** (or press **D**) and choose **Theme**, or press **T** to cycle through them. The choice is saved in the page address, so bookmark the page afterwards. The setup page has a Theme option too.

Themes only change what **your** screen looks like. They never affect the video the other campus receives.

## Adding a theme

1. Copy the folder `public/themes/_template` and rename the copy. The folder name becomes the theme's id: use lowercase letters, numbers and dashes, such as `oxford-stone`.
2. Edit `theme.json` in the new folder (format below). Put any images the theme uses in the same folder.
3. Commit the folder to GitHub, then click **Manual Deploy → Deploy latest commit** in Render.
4. Refresh the portal. The theme appears in the Theme list.

Folders whose names start with `_` are ignored, which is why `_template` doesn't show up. If a `theme.json` has a mistake, that theme is skipped and the reason appears in Render's logs. The other themes still load.

## theme.json

Every field is optional; anything left out uses the default.

| Field | Default | What it does |
|---|---|---|
| `name` | folder name | Name shown in the Theme list |
| `order` | `50` | Position in the list; lower comes first |
| `shape` | `"rect"` | `"rect"`, `"rounded"`, `"circle"`, `"oval"` (an ellipse filling the portal, like a mirror) or `"arch"` |
| `inset` | `0` | Gap between the screen edge and the portal, as a **percentage of the shorter screen side**. `3` is a good start |
| `radius` | `0` | Corner radius in px for `rounded`, and for the bottom corners of `arch` |
| `archRise` | `0.4` | `arch` only: how tall the curved top can be, as a fraction of the portal's height. On portrait screens the top is always a true half-circle |
| `aspect` | `null` | Lock the portal's shape, such as `"4:5"` or `"1:1"`. `null` fills the available space. `circle` is always `1:1`. Video is cropped to fit |
| `border.width` | `0` | Border thickness in px |
| `border.color` | `"transparent"` | Solid border color, any CSS color |
| `border.gradient` | `null` | Any CSS background used for the border instead of `color`: a gradient, or an image such as `"url(stone.jpg) center/cover"` |
| `border.innerWidth` | `0` | Thin accent line just inside the border, in px |
| `border.innerColor` | none | Color of that inner line |
| `border.spin` | `0` | Seconds per full turn for a rotating border. Only works when `gradient` is a `conic-gradient(from var(--spin), …)` |
| `glow.color` | none | Glow around the outside of the portal, any CSS color (use transparency) |
| `glow.size` | `40` | Glow blur in px |
| `glow.spread` | `0` | Glow spread in px |
| `glow.pulse` | `false` | `true` makes the glow breathe slowly |
| `background` | `"#000"` | CSS background for the area around the portal: a color, a gradient, or `"url(room.jpg) center/cover"` |
| `waiting` | see note | CSS background behind the "Waiting for the other campus" message. With a border, the default is transparent, so the empty portal shows |
| `overlay` | `null` | An image drawn on top of everything, such as hand-made frame artwork (see below) |
| `overlayFit` | `"stretch"` | How the overlay fills the screen: `"stretch"`, `"cover"` or `"contain"` |
| `accent` | blue | Accent color for the portal's controls and spinner |
| `logo.file` | none | Logo image in the theme folder (PNG with transparent background, or SVG) |
| `logo.text` | none | Text badge to show instead when there's no `file` yet |
| `logo.position` | `"bottom-left"` | `"bottom-left"`, `"bottom-right"`, `"top-left"` or `"top-right"` |
| `logo.size` | `6` | Logo height as a **percentage of the shorter screen side** |
| `logo.margin` | `2` | Gap from the corner, same units as `size` |
| `logo.anchor` | `"frame"` | `"frame"` places the logo inside the portal's corner; `"screen"` uses the screen corner (better for circles) |
| `logo.plate` | none | CSS background behind the logo for contrast, such as `"rgba(0,0,0,0.5)"` |
| `logo.color` | white | Text color for a text badge |
| `logo.opacity` | `1` | Logo transparency |
| `selfView.shape` | rounded | `"rounded"`, `"rect"` or `"circle"` for your own small video |
| `selfView.radius` | `10` | Corner radius in px for the self-view |
| `selfView.border` | faint white | Self-view border color |

### Different looks for portrait and landscape

Any field can be overridden for one orientation by putting it in a `"portrait"` or `"landscape"` block. The block is used whenever the portal is in that orientation, including on a TV turned on its side. For example, `mirror` is a full-screen oval on a portrait TV, and a 3:4 oval hanging on a wall on a landscape screen:

```json
{
  "shape": "oval",
  "inset": 4,
  "landscape": { "aspect": "3:4", "inset": 5 }
}
```

Nested sections (`border`, `glow`, `logo`, `selfView`) are merged, so `"portrait": { "logo": { "size": 3.5 } }` changes only the logo size. Overlay artwork usually needs one image per orientation: `"overlay": "frame.png", "portrait": { "overlay": "frame-portrait.png" }`.

File names and `url(...)` values are relative to the theme's folder, so `"overlay": "frame.png"` means `public/themes/<your-theme>/frame.png`.

### Adding your logo

The `harlaxton` and `evansville` themes show the campus name as a text badge until a logo file is added. To switch to the real logo, put the file in the theme's folder, for example `public/themes/evansville/logo.png`, and set `"file": "logo.png"` in the `logo` section. Use a PNG with a transparent background, or an SVG, at least 400 px tall. A white or light version usually reads best over video; keep the `plate` if the logo has dark parts.

The self-view sits in the bottom-right corner and the controls appear along the bottom middle, so **bottom-left** or **top-right** are the clearest spots for a logo.

### Example

```json
{
  "name": "Oxford stone",
  "shape": "arch",
  "inset": 3.5,
  "radius": 18,
  "border": { "width": 14, "gradient": "url(stone.jpg) center/cover" },
  "glow": { "color": "rgba(255,214,150,0.3)", "size": 70 },
  "background": "radial-gradient(ellipse at 50% 30%, #2a2219, #0d0a07 80%)",
  "accent": "#e8c58f",
  "selfView": { "radius": 14, "border": "#c8b392" }
}
```

## Overlay artwork

Use an overlay when the border should look like real artwork, such as carved wood, a stone doorway with a keystone, or a campus crest. The `gallery` theme is a working example.

- Make the image the same shape as the screen: **1920×1080** for a landscape screen, **1080×1920** for a portrait one.
- Leave a fully **transparent window** where the video should show. Save as **PNG with transparency** or **SVG**, and keep it under about 2 MB.
- Line the video up with the window using `inset`. Take the window's margin in px, divide by **1080**, and multiply by 100. A 90 px margin gives 8.33, so use `8` to tuck the video's edge just under the frame. Use the same `shape` and `radius` as the window's corners, or a slightly larger window.
- The overlay sits above the video, so keep its edges outside faces.

## Built-in themes

| id | Look |
|---|---|
| (none) | Full screen, no border |
| `harlaxton` | Honey-stone arch with block lines, Harlaxton College badge |
| `mirror` | Gilded oval mirror; full-height in portrait, hanging on a dark wall in landscape |
| `evansville` | UE purple frame with an orange inner line, University of Evansville badge |
| `rounded` | Rounded window with a soft blue glow |
| `arch` | Stone-colored doorway arch |
| `porthole` | Circular window with a metal ring |
| `neon` | Rotating rainbow border with a pulsing glow |
| `gallery` | Gilded picture frame drawn as an SVG overlay |

## Testing a theme

Run the portal locally with `npm start`, then open `http://localhost:8080/?room=test&theme=<id>` in two tabs. Press **T** to cycle themes. Press **O** to switch between landscape and a portrait preview, to check that the border holds up in both.
