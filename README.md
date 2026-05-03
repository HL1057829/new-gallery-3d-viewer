# Interactive 3D Gallery Viewer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20016028.svg)](https://doi.org/10.5281/zenodo.20016028)

A modular touchscreen-friendly system for interacting with 3D artworks.

This project provides a lightweight, installation-ready viewer for gallery environments. Users can rotate a sculpture, drag accessories onto it, and explore multiple configurations — all running locally in a browser using Three.js.

The system is asset-driven, config-driven, and designed to be reused for different artworks and exhibitions.

## Features

### Touch-Friendly Interaction
- One-finger rotate/orbit
- Two-finger gestures for rotation/removal
- Drag items from a tray
- Accessories snap cleanly onto predefined attachment points

### Stackable Accessories
- Accessories can attach:
  - To the main sculpture
  - Or to other accessories
- The system handles stacking rules automatically — no special coding per object.

### Asset-Driven
- Each object (base or accessory) is a self-contained GLB file.
- Each object may define its own attachment points (“sockets”) inside the GLB.
- No special naming conventions beyond simple node identifiers.

### Config-Driven

Everything about an object lives in a small JSON entry:
- Model path
- Preview image
- Optional attachment points
- Optional placement restrictions
- Optional size/scale information
Nothing hardcoded in JavaScript — swapping in new artworks or accessories is as simple as editing the config and dropping in new GLB files.

## Project Structure
```
/assets
    /objects
        base/
            base.glb
            base.obj
            base.mtl
            base_color.jpg
            /irl
                ...reference photos
        accessory_x/
            accessory_x.glb
            accessory_x_color.jpg
            ...
/src
    main.js
    scene.js
    loaders.js
    interaction.js   (future)
    config.json
index.html
README.md
```

## How to Add New Artworks

1. Create a folder for the object under `/assets/objects/<name>/`
2. Export a `.glb` with:
   - Clean transforms
   - Embedded textures
   - Optional empty nodes used as attachment points
3. Add an entry to `config.json` specifying:
   - Model path
   - Preview image for the tray
   - Whether it has attachment points
4. That’s it — no code changes required.

*This design allows an installation team to bring in new sculptures, masks, ornaments, tools, etc., without touching the engine.*

## Installation Use
- Works offline
- Runs smoothly on gallery-sized 55–65” capacitive touch displays
- Small hardware footprint (mini-PC or similar)
- Designed for long-duration stability and easy reboot cycles
- Chrome in kiosk mode recommended

## Development

```
npm install
npm run dev
```
Build for deployment:
```
npm run build
```

Serve locally:
```
npx serve dist
```
## Asset Guidelines

- Use lowercase folder + file names (e.g., `dog.glb`, `mask_bunny.glb`)
- GLB with embedded textures preferred
- Keep polygon counts modest for smooth touch interaction
- Models should face +Z and be upright
- Include a preview image for the accessory tray

---

## Author

**Wesley Modes**  
University of Cincinnati  
ORCID: [0009-0000-1191-8245](https://orcid.org/0009-0000-1191-8245)

---

## Citation

If you use or reference this project in academic work, please cite it as:

```bibtex
@software{modes_2025_gallery3dviewer,
  author    = {Modes, Wesley},
  title     = {{Interactive 3D Gallery Viewer}},
  year      = {2025},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.20016028},
  url       = {https://doi.org/10.5281/zenodo.20016028},
  orcid     = {0009-0000-1191-8245}
}
```

---

## License

MIT