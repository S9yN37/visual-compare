# Visual Compare

See the real-world size of things side by side in 3D: phones, laptops, speakers, furniture, cars, or anything you measure yourself.

**[Open Visual Compare →](https://s9yn37.github.io/visual-compare/)**

## Features

- **Layouts:** side by side, stacked, one behind another, or nested
- **Views:** 3D, top, front and side
- **Details:** volume, front area, footprint and size ratios for each object
- **Sharing:** the whole scene lives in the URL, so a link is a saved comparison
- **Export:** PNG images and AR on phones (Quick Look on iOS, WebXR on Android)
- **Objects:** a catalog of everyday things, plus custom sizes in mm, cm, m, in or ft
- **Themes:** light, dark, or follow the system
- **Keyboard shortcuts:** press `?` in the app

On a supported phone, tap AR to prepare the comparison, then tap **Start AR** to launch it. Changing the comparison prepares a new model on the next tap.

## Run Locally

No build step. Open `index.html` in a browser, or run the optional server to share saved sessions between devices:

```sh
npm start   # http://localhost:8765, needs Node 22.13+
```

Without the server, sessions are saved in the browser.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app |
| `items.js` | The catalog: `[name, width, height, depth, corner radius, shape]` in mm |
| `server.js` | Optional static server with a shared sessions API (SQLite) |

## URL Format

```
?items=phone/iphone-18-pro-max,custom:Name:380:158:8&view=front&unit=in
```

Catalog items are `category/slug`. Custom items are `custom:Name:width:height:depth[:radius]` in mm. Settings only appear when they differ from the defaults.

## License

[MIT](LICENSE)
