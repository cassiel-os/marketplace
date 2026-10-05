# Cassiel Marketplace

The apps Cassiel's Marketplace offers. Cassiel reads [`catalog.json`](catalog.json)
straight from this repository and installs an app by downloading its `.capp` package
from here; the Setup wizard shows what the app may do before it is installed.

**Only what is on `main` is approved.** Every entry points at the package on the main
branch and carries its SHA-256: Cassiel lists only entries from here and refuses a
download that is not byte for byte the approved package.

**Branches.** `main` holds only what is published: the catalog and the packages. Each
app's source is a branch named after its id (`run.cassiel.paint`), where it is built
into the package that a pull request then brings to `main`.

## Apps

<!-- apps -->
| | App | Version | By | |
|---|---|---|---|---|
| <img src="apps/run.cassiel.checkers/icon.svg" width="24" alt=""> | **Checkers** | 1.0.0 | Cassiel | Play checkers against Cass. |
| <img src="apps/run.cassiel.paint/icon.svg" width="24" alt=""> | **Paint** | 0.2.0 | Cassiel | Draw, paint and edit pictures. |
<!-- /apps -->

## Publishing an app

1. Keep the app's source in its own branch here, named after its id. Build the package
   from it (see Cassiel's `docs/app-sdk.md`): `scripts/pack-app.sh path/to/app` in the
   Cassiel repo makes `build/<id>.capp`.
2. Here: `node scripts/publish.mjs path/to/<id>.capp`. It checks the manifest (`id`,
   `name`, a `version` newer than the published one, `sdk`, `category`), copies the
   package to `apps/<id>/<id>-<version>.capp`, takes out its icon, writes the catalog
   entry from the package's own manifest with its checksum, and updates the list above.
3. `node scripts/verify.mjs` checks that every entry matches its package byte for byte.
   It runs on every pull request too (GitHub Actions).
4. Open a pull request. The maintainer reviews every app and is the only one who
   merges into `main`; once merged, the app is in the Marketplace.

An app's id is a reverse domain of its maker plus its name (`com.example.paint`); an app
is only published under a domain that belongs to whoever makes it.

`node scripts/publish.mjs --remove <id>` takes an app out.

Earlier versions of a package stay in its folder: a catalog cached for a few minutes
may still point at one.

## Layout

```
catalog.json                    { "apps": [ { id, name, version, description, author,
                                  category, sdk, icon, package, bytes, sha256 } ] }
apps/<id>/<id>-<version>.capp   the package
apps/<id>/icon.svg              its icon (or icon.png)
scripts/                        publish.mjs, verify.mjs
```

## Licenses

This repository's own files are under the MIT license ([LICENSE](LICENSE)). Each package
carries its own: Paint is based on [JS Paint](https://github.com/1j01/jspaint) by Isaiah
Odhner (MIT).
