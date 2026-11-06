# M.U.G.E.N.js for Cassiel

Plays your own MUGEN characters and stages in Cassiel, with
[mugen-js](https://github.com/yojona/mugen-js), a browser version of the MUGEN 1.1 engine.

**No game data is included.** Copy what is inside your MUGEN folder (`data`, `chars`,
`stages`, `font`...) to `App Files/M.U.G.E.N.js/game`. It needs no permission to reach them.

- Options, key configuration and debug mode work as `data/mugen.cfg` sets them.
- Keyboard and game controllers work. A controller alone can't start the sound, which
  browsers only allow after a key press, click or touch.
- Music plays from MP3, Ogg and WAV files your `.def` files point at. MIDI and tracker
  modules stay silent.

## Build

`mugen.min.js` is the file from mugen-js's release (now v0.1.0).

```sh
cd ~/apps/cassiel && scripts/pack-app.sh ~/apps/cassiel-mugen   # build/run.cassiel.mugen.capp
scripts/install-app.sh ~/apps/cassiel-mugen                     # into the dev desktop
```

## Third parties

`mugen.min.js` is mugen-js 0.1.0. Its license and what it does not cover are in
`LICENSE-mugen-js.txt`. M.U.G.E.N is a name of Elecbyte; this app is not affiliated with
or endorsed by them.
