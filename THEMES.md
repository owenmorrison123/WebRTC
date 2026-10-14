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
| `shape` | `"rect"` | `"rect"`, `"rounded"`, `"circle"` or `"arch"` |
| `inset` | `0` | Gap between the screen edge and the portal, as a **percentage of the shorter screen side**. `3` is a good start |
| `radius` | `0` | Corner radius in px for `rounded`, and for the bottom corners of `arch` |
| `archRise` | `0.4` | `arch` only: how tall the curved top can be, as a fraction of the portal's height. On portrait screens the top is always a true half-circle |
| `aspect` | `null` | Lock the portal's shape, such as `"4:5"` or `"1:1"`. `null` fills the available space. `circle` is always `1:1`. Video is cropped to fit |
| `border.width` | `0` | Border thickness in px |
| `border.color` | `"transparent"` | Solid border color, any CSS color |
| `border.gradient` | `null` | Any CSS background used for the border instead of `color`: a gradient, or an image such as `"url(stone.jpg) center/cover"` |
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
| `selfView.shape` | rounded | `"rounded"`, `"rect"` or `"circle"` for your own small video |
| `selfView.radius` | `10` | Corner radius in px for the self-view |
| `selfView.border` | faint white | Self-view border color |

File names and `url(...)` values are relative to the theme's folder, so `"overlay": "frame.png"` means `public/themes/<your-theme>/frame.png`.

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
| `rounded` | Rounded window with a soft blue glow |
| `arch` | Stone-colored doorway arch |
| `porthole` | Circular window with a metal ring |
| `neon` | Rotating rainbow border with a pulsing glow |
| `gallery` | Gilded picture frame drawn as an SVG overlay |

## Testing a theme

Run the portal locally with `npm start`, then open `http://localhost:8080/?room=test&theme=<id>` in two tabs. Press **T** to cycle themes. Resize the window, or try a portrait window, to check that the border holds up at different shapes.
