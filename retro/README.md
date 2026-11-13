# Retro hotel

The hotel at retro.steamvaluechecker.com, deployed as its own Fly app (`steamvaluechecker-retro`). The bot's app is not touched.

Deploy: on GitHub, Actions, **Deploy hotel to Fly**, Run workflow. The first boot sets up the database. The admin login appears once in the Fly logs.

The game server comes from Jacob-Lucado/EMU and the LucadoOS website from Jacob-Lucado/CMS. LucadoOS™ is a trademark of Jacob Lucado.

`rootfs/etc/hotel/renderer-config.json`, `ui-config.json` and `client-mode.json` come from [plusemu-installer](https://github.com/plus-emulator/plusemu-installer) (GPL-3.0).
