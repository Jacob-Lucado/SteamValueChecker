# The hotel at retro.steamvaluechecker.com in one image: the game server from the EMU repo, the LucadoOS
# website from the CMS repo, the Volt game client and its hotel files, MariaDB, PHP and nginx.
# Everything that has to survive a deploy lives on the /data volume (see hotel-start).

ARG EMU_REPO=https://github.com/Jacob-Lucado/EMU.git
ARG EMU_REF=main
# The deploy workflow sets these to the newest commits, so a cached build of an older commit is never reused.
ARG EMU_SHA=unknown
ARG CMS_SHA=unknown
ARG CMS_REPO=https://github.com/Jacob-Lucado/CMS.git
ARG CMS_REF=main
ARG VOLT_VERSION=v1.0.4
# The renderer commit that matches this Volt release.
ARG VOLT_RENDERER_REF=c8f74ffd
ARG ADMINER_VERSION=6.3.0
ARG HOTEL_FILES_URL=https://github.com/plus-emulator/plusemu-installer/releases/download/hotel-files

# ---------------------------------------------------------------- game server
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS emulator
ARG EMU_REPO
ARG EMU_REF
ARG EMU_SHA
WORKDIR /src
RUN echo "EMU $EMU_SHA" && git clone --depth 1 --branch "$EMU_REF" "$EMU_REPO" . \
    && dotnet publish "Plus Emulator.csproj" -c Release -r linux-x64 --self-contained \
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o /out \
    && mkdir -p /out/Database \
    && cp Database/FreshInstall.sql /out/Database/ \
    && cp -r Database/Migrations /out/Database/ \
    && mkdir -p /out/CameraRenderer \
    && cp CameraRenderer/package.json CameraRenderer/package-lock.json CameraRenderer/*.mjs /out/CameraRenderer/ \
    && rm -f /out/CameraRenderer/*.test.mjs

# ---------------------------------------------------------------- game client, built from source
FROM node:22 AS client
ARG VOLT_VERSION
ARG VOLT_RENDERER_REF
WORKDIR /w
RUN git clone -q --depth 1 --branch "$VOLT_VERSION" https://github.com/plus-emulator/Volt.git Volt \
    && git clone -q https://github.com/plus-emulator/Volt-Renderer.git Volt-Renderer \
    && git -C Volt-Renderer checkout -q "$VOLT_RENDERER_REF"
COPY client/patches/ patches/
RUN for patch in patches/renderer-*.patch; do git -C Volt-Renderer apply "/w/$patch"; done
# Pixel-font labels draw on a transparent canvas, so the redesigned dark windows show through behind them.
RUN corepack enable \
    && (cd Volt-Renderer && yarn install --immutable) \
    && (cd Volt && yarn install --immutable && yarn vite build) \
    && test -f Volt/dist/index.html
COPY client/lucadoos-skin.css Volt/dist/lucadoos/skin.css
RUN v=$(sha1sum Volt/dist/lucadoos/skin.css | cut -c1-10) \
    && sed -i "0,/<\/style>/s##</style>\n    <link rel=\"stylesheet\" href=\"./lucadoos/skin.css?v=$v\" />#" Volt/dist/index.html \
    && grep -q 'lucadoos/skin.css' Volt/dist/index.html

# ---------------------------------------------------------------- hotel files
FROM ubuntu:24.04 AS downloads
ARG ADMINER_VERSION
ARG VOLT_VERSION
ARG HOTEL_FILES_URL
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN curl -fsSL --retry 3 "https://github.com/vrana/adminer/releases/download/v$ADMINER_VERSION/adminer-$ADMINER_VERSION-mysql-en.php" -o adminer.php \
    && grep -q 'adminer_object' adminer.php
RUN curl -fsSL --retry 3 "$HOTEL_FILES_URL/hotel-files.tar.gz" -o files.tar.gz \
    && curl -fsSL --retry 3 "$HOTEL_FILES_URL/SHA256SUMS" -o SHA256SUMS \
    && echo "$(awk '$2 == "hotel-files.tar.gz" || $2 == "*hotel-files.tar.gz" {print $1}' SHA256SUMS)  files.tar.gz" | sha256sum -c - \
    && mkdir hotel-files && tar xzf files.tar.gz --no-same-owner -C hotel-files && rm files.tar.gz SHA256SUMS
# Extra furni packs (tools/import-nitro-furni.py): their bundles sit beside the official ones under the
# .hab name the client asks for, and the client reads each file by its own header.
COPY furni/ furni/
RUN mkdir -p furni-sql hotel-files/c_images/hof_furni/icons \
    && for pack in furni/*/; do \
         slug=$(basename "$pack"); \
         for bundle in "$pack"bundles/*.nitro; do cp "$bundle" "hotel-files/assets/furniture/$(basename "$bundle" .nitro).hab"; done; \
         cp "$pack"icons/*.png hotel-files/c_images/hof_furni/icons/ 2> /dev/null || true; \
         cp "$pack"furniture.sql "furni-sql/$slug.sql"; \
       done

# ---------------------------------------------------------------- runtime
FROM ubuntu:24.04
# The commit ids are declared only where they are used: every RUN after an ARG sees it, so a new commit
# would otherwise rebuild the system packages and Chromium on every deploy.
ENV DEBIAN_FRONTEND=noninteractive \
    COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1 \
    HOTEL=/var/www/hotel

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg software-properties-common \
    && add-apt-repository -y ppa:ondrej/php \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx mariadb-server mariadb-client supervisor git unzip jq libicu74 xz-utils gettext-base \
        php8.5-fpm php8.5-cli php8.5-mysql php8.5-mbstring php8.5-xml php8.5-curl php8.5-gd \
        php8.5-intl php8.5-zip php8.5-bcmath \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default

# The camera service draws photos in a headless Chromium. Installed early so it is rarely downloaded again.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npx -y playwright@1.63.0 install --with-deps --only-shell chromium && rm -rf /root/.npm /var/lib/apt/lists/*

# The big files that rarely change come first, so a website or game server change never re-uploads them.
COPY --from=client /w/Volt/dist "$HOTEL/client"
COPY --from=downloads /dl/hotel-files "$HOTEL/hotel-files"
COPY --from=downloads /dl/furni-sql /etc/hotel/furni/
COPY --from=downloads /dl/adminer.php "$HOTEL/adminer/adminer.php"

# The website, built once here. Its database setup runs on first boot, when the volume is there.
ARG CMS_REPO
ARG CMS_REF
ARG CMS_SHA
RUN echo "CMS $CMS_SHA" && git clone --depth 1 --branch "$CMS_REF" "$CMS_REPO" "$HOTEL/cms" \
    && cd "$HOTEL/cms" \
    && composer install --no-dev --optimize-autoloader --no-progress \
    && npm ci --no-audit --no-fund \
    && npm run build:lucadoos \
    && rm -rf node_modules \
    && rm -rf storage && ln -s /data/storage storage \
    && ln -s /data/cms.env .env

COPY --from=emulator /out "$HOTEL/emulator"
RUN cd "$HOTEL/emulator/CameraRenderer" \
    && npm ci --omit=dev --no-audit --no-fund \
    && npx playwright install --only-shell chromium \
    && rm -rf /root/.npm
COPY rootfs/ /

RUN useradd --system --home-dir "$HOTEL/emulator" --shell /usr/sbin/nologin plusemu \
    && sed -i '1s/^\xEF\xBB\xBF//' "$HOTEL/emulator/Config/config.json" \
    && sed -i 's/minlevel="Trace"/minlevel="Info"/' "$HOTEL/emulator/Config/nlog.config" \
    && cp "$HOTEL/emulator/Config/config.json" /etc/hotel/emulator-config.json \
    && chmod +x /usr/local/bin/hotel-start /usr/local/bin/hotel-client-config

# Lets hotel-start skip the slow setup steps when the code is the same as on the last boot.
ARG EMU_SHA
ENV CMS_SHA=$CMS_SHA EMU_SHA=$EMU_SHA

EXPOSE 8000
CMD ["/usr/local/bin/hotel-start"]
