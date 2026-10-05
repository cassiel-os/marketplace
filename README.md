# Neo Arcade

Neo Geo and arcade games from your own ROMs, in Cassiel. FinalBurn Neo plays them,
through [Nostalgist](https://nostalgist.js.org) (RetroArch in the browser); the core
ships in `core/`, so it works offline.

- Its folder is App Files/Neo Arcade (its folder in App Files, code and all): put
  your ROMs in `roms/` (zip files named by their set: `mslug.zip`) with `neogeo.zip`,
  the Neo Geo BIOS. It needs no permission to reach them.
- Pictures: `snaps/<set>.png`; a game without one gets it after a while of play (F12
  takes one any time).
- Saved games: `saves/<set>.state` (F2 saves, F4 loads).

ROMs and BIOS are not included: they belong to their owners.

## Third parties

- `type/`: Russo One and Exo 2, SIL Open Font License (`type/OFL-*.txt`), in the app so
  it needs no network.
- `nostalgist.js`: Nostalgist 0.22.0, MIT (`LICENSE-nostalgist.txt`).
- `core/fbneo_libretro.{js,wasm}`: FinalBurn Neo's libretro core, RetroArch 1.22.2
  Emscripten build from [retroarch-emscripten-build](https://github.com/arianrhodsandlot/retroarch-emscripten-build)
  (v1.22.2). FinalBurn Neo is free for non-commercial use; its license is in
  `LICENSE-fbneo.txt` and its source at https://github.com/libretro/FBNeo.
