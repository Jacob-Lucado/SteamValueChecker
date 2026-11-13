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
    && cp -r Database/Migrations /out/Database/

# ---------------------------------------------------------------- client and hotel files
FROM ubuntu:24.04 AS downloads
ARG ADMINER_VERSION
ARG VOLT_VERSION
ARG HOTEL_FILES_URL
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN curl -fsSL --retry 3 "https://github.com/plus-emulator/Volt/releases/download/$VOLT_VERSION/volt-client.zip" -o volt.zip \
    && mkdir client && unzip -q volt.zip -d client && rm volt.zip \
    && test -f client/index.html
RUN curl -fsSL --retry 3 "https://github.com/vrana/adminer/releases/download/v$ADMINER_VERSION/adminer-$ADMINER_VERSION-mysql-en.php" -o adminer.php \
    && grep -q 'adminer_object' adminer.php
RUN curl -fsSL --retry 3 "$HOTEL_FILES_URL/hotel-files.tar.gz" -o files.tar.gz \
    && curl -fsSL --retry 3 "$HOTEL_FILES_URL/SHA256SUMS" -o SHA256SUMS \
    && echo "$(awk '$2 == "hotel-files.tar.gz" || $2 == "*hotel-files.tar.gz" {print $1}' SHA256SUMS)  files.tar.gz" | sha256sum -c - \
    && mkdir hotel-files && tar xzf files.tar.gz --no-same-owner -C hotel-files && rm files.tar.gz SHA256SUMS

# ---------------------------------------------------------------- runtime
FROM ubuntu:24.04
ARG CMS_REPO
ARG CMS_REF
ARG CMS_SHA
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

# The big files that rarely change come first, so a website or game server change never re-uploads them.
COPY --from=downloads /dl/client "$HOTEL/client"
COPY --from=downloads /dl/hotel-files "$HOTEL/hotel-files"
COPY --from=downloads /dl/adminer.php "$HOTEL/adminer/adminer.php"

# The website, built once here. Its database setup runs on first boot, when the volume is there.
RUN echo "CMS $CMS_SHA" && git clone --depth 1 --branch "$CMS_REF" "$CMS_REPO" "$HOTEL/cms" \
    && cd "$HOTEL/cms" \
    && composer install --no-dev --optimize-autoloader --no-progress \
    && npm ci --no-audit --no-fund \
    && npm run build:lucadoos \
    && rm -rf node_modules \
    && rm -rf storage && ln -s /data/storage storage \
    && ln -s /data/cms.env .env

COPY --from=emulator /out "$HOTEL/emulator"
COPY rootfs/ /

RUN useradd --system --home-dir "$HOTEL/emulator" --shell /usr/sbin/nologin plusemu \
    && sed -i '1s/^\xEF\xBB\xBF//' "$HOTEL/emulator/Config/config.json" \
    && sed -i 's/minlevel="Trace"/minlevel="Info"/' "$HOTEL/emulator/Config/nlog.config" \
    && cp "$HOTEL/emulator/Config/config.json" /etc/hotel/emulator-config.json \
    && chmod +x /usr/local/bin/hotel-start

EXPOSE 8000
CMD ["/usr/local/bin/hotel-start"]
