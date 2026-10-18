# Visual Compare

See the real-world size of things side by side in 3D: phones, laptops, speakers, furniture, cars, or anything you measure yourself.

**[Open Visual Compare →](https://s9yn37.github.io/visual-compare/)**

## Features

- **Layouts:** side by side, stacked, one behind another, or nested
- **Views:** 3D, top, front and side
- **Details:** volume, front area, footprint and size ratios for each item
- **Sharing:** the whole scene lives in the URL, so a link is a saved comparison
- **Export:** PNG images and AR on phones (Quick Look on iOS, WebXR on Android)
- **Items:** a catalog of everyday things, plus custom sizes in mm, cm, m, in or ft
- **Themes:** light, dark, or follow the system
- **Keyboard shortcuts:** press `?` in the app

On a supported phone, tap AR to prepare the comparison, then tap **Start AR** to launch it. Changing the comparison prepares a new model on the next tap.

## Run Locally

No build step. Open `index.html` in a browser, or run the optional server to share saved sessions between devices:

```sh
npm start   # http://localhost:8765, needs Node 22.13+
```

Without the server, sessions are saved in the browser.

GitHub Pages automatically builds and deploys pushes to `main`. The build stamps script and CSS URLs with a content hash and generates `version.json`; no manual versioning is needed. The app checks for a newer version on startup and reloads once while preserving the comparison URL. Failed update checks do not prevent startup. Local use needs no build step; `npm run build` optionally generates the deployable `_site/` folder.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app |
| `items.js` | The catalog: `[name, width, height, depth, x, y, z]` in mm (see Shapes) |
| `server.js` | Optional static server with a shared sessions API (SQLite) |

## Shapes

Every item is a box written as it stands — width left–right, height up, depth toward the viewer — plus optional radii `x, y, z` for the edges running along width, height and depth. Each radius is at most half of the two sizes it rounds across.

| Item | Sizes | x, y, z |
| --- | --- | --- |
| Brick | 215, 65, 102.5 | — |
| Phone | 78, 163.4, 8.75 | 2, 2, 12 |
| Coin | 23.25, 23.25, 2.33 | 0, 0, 11.625 |
| Upright can | 66, 115, 66 | 0, 33, 0 |
| Battery with rounded rims | 14.5, 50.5, 14.5 | 1, 7.25, 1 |
| Ball | 67, 67, 67 | 33.5, 33.5, 33.5 |

The odd radius rounds the outline around its axis and the matching pair rounds that outline's rims, so two of the three must match. Rims larger than the outline radius meet in a mitered corner.

Tip (X), Turn (Y) and Roll (Z) swap two sizes together with their radii.

## URL Format

```
?items=phone/iphone-18-pro-max,common/soda-can-330-ml!wdh,custom:Can:66:115:66:0:33:0&view=front&unit=in
```

Catalog items are `category/slug`, followed by `!` and the new size order when turned (`!wdh`: the item's depth now runs along its height). Custom items are `custom:Name:width:height:depth[:x:y:z]` in mm, as they stand. Settings only appear when they differ from the defaults.

## License

[MIT](LICENSE)
