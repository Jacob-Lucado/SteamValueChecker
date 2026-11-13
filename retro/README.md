# Retro hotel

The hotel at retro.steamvaluechecker.com, deployed as its own Fly app (`steamvaluechecker-retro`). The bot's app is not touched.

Deploy: on GitHub, Actions, **Deploy hotel to Fly**, Run workflow. The first boot sets up the database. The admin login appears once in the Fly logs.

The game server comes from Jacob-Lucado/EMU and the LucadoOS website from Jacob-Lucado/CMS. LucadoOS™ is a trademark of Jacob Lucado.

`rootfs/etc/hotel/renderer-config.json`, `ui-config.json` and `client-mode.json` come from [plusemu-installer](https://github.com/plus-emulator/plusemu-installer) (GPL-3.0).

## Adding Nitro furni packs

Packs released for Nitro (`.nitro` bundles, the `items_base` SQL and furnidata) can be added with:

```
python3 tools/import-nitro-furni.py "<unzipped pack folder>" <slug> "<catalog page name>" [--price 3] [--header catalog_xmas_headline1]
```

It writes `furni/<slug>/`. Commit that folder and deploy: the furni go next to the hotel's own, and the page
shows up at the top of the Furni tab. The client reads each furni file by its own header, so Nitro and
Habbo furni work side by side.
