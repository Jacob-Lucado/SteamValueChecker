// Languages for the bot. Twelve of the most used on Steam. Anything missing falls back to English.
// The dashboard has its own phrase list in public/i18n.js.
export const LANGS = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano", ru: "Русский", pl: "Polski", tr: "Türkçe", ja: "日本語", ko: "한국어", zh: "中文" };

// Order of the columns in every table below (English is the key itself).
const ORDER = ["es", "fr", "de", "pt", "it", "ru", "pl", "tr", "ja", "ko", "zh"];

/** Discord's locale code for each language, used for command descriptions. Discord shows them by the viewer's own client language. */
export const DISCORD_LOCALE = { es: "es-ES", fr: "fr", de: "de", pt: "pt-BR", it: "it", ru: "ru", pl: "pl", tr: "tr", ja: "ja", ko: "ko", zh: "zh-CN" };

// ---- buttons and short labels in alerts and menus ----
const ROWS = {
    "Stop watching": ["Dejar de seguir", "Ne plus suivre", "Nicht mehr beobachten", "Parar de seguir", "Smetti di seguire", "Перестать следить", "Przestań obserwować", "Takibi bırak", "ウォッチをやめる", "추적 중지", "停止关注"],
    "Snooze 7 days": ["Posponer 7 días", "Reporter 7 jours", "7 Tage pausieren", "Adiar 7 dias", "Posticipa 7 giorni", "Отложить на 7 дней", "Odłóż na 7 dni", "7 gün ertele", "7日間スヌーズ", "7일간 미루기", "推迟 7 天"],
    "Only below a price…": ["Solo bajo un precio…", "Seulement sous un prix…", "Nur unter einem Preis…", "Só abaixo de um preço…", "Solo sotto un prezzo…", "Только ниже цены…", "Tylko poniżej ceny…", "Yalnızca bir fiyatın altında…", "指定価格以下のみ…", "특정 가격 이하일 때만…", "仅低于某价格时…"],
    "Steam page": ["Página de Steam", "Page Steam", "Steam-Seite", "Página da Steam", "Pagina Steam", "Страница в Steam", "Strona Steam", "Steam sayfası", "Steamのページ", "Steam 페이지", "Steam 页面"],
    "Price history": ["Historial de precios", "Historique des prix", "Preisverlauf", "Histórico de preços", "Storico prezzi", "История цен", "Historia cen", "Fiyat geçmişi", "価格履歴", "가격 기록", "价格历史"],
    "View deal": ["Ver oferta", "Voir l'offre", "Angebot ansehen", "Ver oferta", "Vedi offerta", "Открыть скидку", "Zobacz ofertę", "Fırsata git", "セールを見る", "할인 보기", "查看优惠"],
    "Welcome": ["Bienvenido", "Bienvenue", "Willkommen", "Bem-vindo", "Benvenuto", "Добро пожаловать", "Witaj", "Hoş geldin", "ようこそ", "환영합니다", "欢迎"],
    "Nav:Wishlist": ["Lista de deseos", "Liste de souhaits", "Wunschliste", "Lista de desejos", "Lista dei desideri", "Список желаемого", "Lista życzeń", "İstek listesi", "ウィッシュリスト", "위시리스트", "愿望单"],
    "Nav:Library": ["Biblioteca", "Bibliothèque", "Bibliothek", "Biblioteca", "Libreria", "Библиотека", "Biblioteka", "Kütüphane", "ライブラリ", "라이브러리", "游戏库"],
    "Nav:Alerts": ["Alertas", "Alertes", "Benachrichtigungen", "Alertas", "Avvisi", "Оповещения", "Powiadomienia", "Uyarılar", "通知", "알림", "提醒"],
    "Nav:Support": ["Soporte", "Assistance", "Support", "Suporte", "Supporto", "Поддержка", "Pomoc", "Destek", "サポート", "지원", "支持"],
    "Nav:Notifications": ["Avisos", "Notifications", "Mitteilungen", "Notificações", "Notifiche", "Уведомления", "Powiadomienia", "Bildirimler", "お知らせ", "알림함", "通知"],
    "Was this helpful?": ["¿Te sirvió?", "Cela vous a aidé ?", "War das hilfreich?", "Isso ajudou?", "Ti è stato utile?", "Это помогло?", "Czy to pomogło?", "Bu işe yaradı mı?", "お役に立ちましたか？", "도움이 되었나요?", "这有帮助吗？"]
};

const T = Object.fromEntries(ORDER.map((l, n) => [l, Object.fromEntries(Object.entries(ROWS).map(([k, v]) => [k, v[n]]))]));
export const tr = (lang, key) => T[lang]?.[key] ?? key.replace(/^Nav:/, "");
export const dictionary = lang => T[lang] ?? {};

/** What /language says back, in the language that was just chosen. */
const DONE = {
    en: "Done. Buttons and messages are in English.",
    es: "Listo. Los botones y mensajes clave ahora están en español.",
    fr: "C'est fait. Les boutons et messages clés sont maintenant en français.",
    de: "Erledigt. Schaltflächen und wichtige Nachrichten sind jetzt auf Deutsch.",
    pt: "Pronto. Os botões e as mensagens principais agora estão em português.",
    it: "Fatto. Pulsanti e messaggi principali ora sono in italiano.",
    ru: "Готово. Кнопки и главные сообщения теперь на русском.",
    pl: "Gotowe. Przyciski i najważniejsze wiadomości są teraz po polsku.",
    tr: "Tamam. Düğmeler ve önemli mesajlar artık Türkçe.",
    ja: "設定しました。ボタンと主なメッセージが日本語になります。",
    ko: "완료했어요. 버튼과 주요 메시지가 한국어로 표시됩니다.",
    zh: "好了。按钮和主要消息现在使用中文。"
};
export const languageDone = lang => DONE[lang] ?? DONE.en;

// ---- slash command descriptions ----
// Discord shows these in each person's own Discord language, so the bot cannot switch them per person. Names stay as they are
// (the same /games and /me everywhere keeps help pages, guides and screenshots true). Only the top-level descriptions are translated;
// subcommand descriptions stay in English.
const DESC = {
    "Prices, deals, free games and sales": ["Precios, ofertas, juegos gratis y rebajas", "Prix, offres, jeux gratuits et soldes", "Preise, Angebote, Gratisspiele und Sales", "Preços, ofertas, jogos grátis e promoções", "Prezzi, offerte, giochi gratis e saldi", "Цены, скидки, бесплатные игры и распродажи", "Ceny, oferty, darmowe gry i wyprzedaże", "Fiyatlar, fırsatlar, ücretsiz oyunlar ve indirimler", "価格、セール、無料ゲーム", "가격, 할인, 무료 게임, 세일", "价格、优惠、免费游戏和促销"],
    "Your wishlist, library, Steam link, alerts and data": ["Tu lista de deseos, biblioteca, enlace de Steam, alertas y datos", "Votre liste de souhaits, bibliothèque, lien Steam, alertes et données", "Deine Wunschliste, Bibliothek, Steam-Verknüpfung, Alarme und Daten", "Sua lista de desejos, biblioteca, link da Steam, alertas e dados", "La tua lista dei desideri, libreria, collegamento Steam, avvisi e dati", "Ваш список желаемого, библиотека, привязка Steam, оповещения и данные", "Twoja lista życzeń, biblioteka, powiązanie ze Steam, powiadomienia i dane", "İstek listen, kütüphanen, Steam bağlantın, uyarıların ve verilerin", "ウィッシュリスト、ライブラリ、Steam連携、通知、データ", "내 위시리스트, 라이브러리, Steam 연결, 알림, 데이터", "你的愿望单、游戏库、Steam 绑定、提醒和数据"],
    "Your server: giveaways, game nights, levels, boards and events": ["Tu servidor: sorteos, noches de juego, niveles, rankings y eventos", "Votre serveur : concours, soirées jeux, niveaux, classements et événements", "Dein Server: Verlosungen, Spieleabende, Level, Ranglisten und Events", "Seu servidor: sorteios, noites de jogos, níveis, rankings e eventos", "Il tuo server: giveaway, serate di gioco, livelli, classifiche ed eventi", "Ваш сервер: розыгрыши, игровые вечера, уровни, рейтинги и события", "Twój serwer: konkursy, wieczory z grami, poziomy, rankingi i wydarzenia", "Sunucun: çekilişler, oyun geceleri, seviyeler, sıralamalar ve etkinlikler", "サーバー：プレゼント企画、ゲームナイト、レベル、ランキング、イベント", "내 서버: 경품 행사, 게임 나이트, 레벨, 순위, 이벤트", "你的服务器：抽奖、游戏之夜、等级、排行榜和活动"],
    "Server managers: setup, community, alert channels and emoji": ["Gestores del servidor: configuración, comunidad, canales de alertas y emojis", "Gestionnaires du serveur : configuration, communauté, salons d'alertes et émojis", "Server-Manager: Einrichtung, Community, Alarm-Kanäle und Emojis", "Gerentes do servidor: configuração, comunidade, canais de alertas e emojis", "Gestori del server: configurazione, community, canali di avviso ed emoji", "Управление сервером: настройка, сообщество, каналы оповещений и эмодзи", "Zarządzający serwerem: konfiguracja, społeczność, kanały powiadomień i emoji", "Sunucu yöneticileri: kurulum, topluluk, uyarı kanalları ve emojiler", "サーバー管理者向け：設定、コミュニティ、通知チャンネル、絵文字", "서버 관리자용: 설정, 커뮤니티, 알림 채널, 이모지", "服务器管理：设置、社区、提醒频道和表情"],
    "About the bot, its status, changelog, support and ideas": ["Sobre el bot, su estado, novedades, soporte e ideas", "À propos du bot, son état, les nouveautés, l'aide et les idées", "Über den Bot, Status, Neuigkeiten, Support und Ideen", "Sobre o bot, status, novidades, suporte e ideias", "Informazioni sul bot, stato, novità, supporto e idee", "О боте, его состояние, новости, поддержка и идеи", "O bocie, jego stan, nowości, pomoc i pomysły", "Bot hakkında, durumu, yenilikler, destek ve fikirler", "ボットについて、状態、更新情報、サポート、アイデア", "봇 정보, 상태, 업데이트 내역, 지원, 아이디어", "关于机器人、状态、更新日志、支持和建议"],
    "How to use Steam Value Checker": ["Cómo usar Steam Value Checker", "Comment utiliser Steam Value Checker", "So benutzt du Steam Value Checker", "Como usar o Steam Value Checker", "Come usare Steam Value Checker", "Как пользоваться Steam Value Checker", "Jak korzystać z Steam Value Checker", "Steam Value Checker nasıl kullanılır", "Steam Value Checkerの使い方", "Steam Value Checker 사용법", "如何使用 Steam Value Checker"],
    "Get the link to the dashboard": ["Obtén el enlace al panel web", "Obtenir le lien du tableau de bord", "Link zum Dashboard abrufen", "Receba o link do painel", "Ottieni il link alla dashboard", "Получить ссылку на панель", "Pobierz link do panelu", "Panelin bağlantısını al", "ダッシュボードのリンクを取得", "대시보드 링크 받기", "获取控制面板链接"],
    "How and where you get sale alerts": ["Cómo y dónde recibes las alertas de ofertas", "Comment et où recevoir les alertes de promotions", "Wie und wo du Angebots-Alarme bekommst", "Como e onde você recebe os alertas de ofertas", "Come e dove ricevi gli avvisi sulle offerte", "Как и где вы получаете оповещения о скидках", "Jak i gdzie dostajesz powiadomienia o promocjach", "İndirim uyarılarını nasıl ve nereden alırsın", "セール通知の受け取り方と場所", "할인 알림을 받는 방법과 장소", "如何以及在哪里接收优惠提醒"],
    "Moderators: warn, time out, kick, ban and clean up. Every action is logged": ["Moderadores: advertir, aislar, expulsar, vetar y limpiar. Todo queda registrado", "Modérateurs : avertir, exclure temporairement, expulser, bannir et nettoyer. Tout est journalisé", "Moderatoren: verwarnen, Timeout, kicken, bannen und aufräumen. Alles wird protokolliert", "Moderadores: avisar, silenciar, expulsar, banir e limpar. Tudo fica registrado", "Moderatori: avvisa, silenzia, espelli, banna e pulisci. Ogni azione viene registrata", "Модераторы: предупреждения, мьют, кик, бан и очистка. Все действия записываются", "Moderatorzy: ostrzeżenia, wyciszenia, wyrzucanie, bany i sprzątanie. Wszystko jest logowane", "Moderatörler: uyar, sustur, at, yasakla ve temizle. Her işlem kaydedilir", "モデレーター向け：警告、タイムアウト、キック、BAN、削除。すべて記録されます", "관리자용: 경고, 타임아웃, 추방, 차단, 정리. 모든 조치가 기록됩니다", "管理员：警告、禁言、踢出、封禁和清理。所有操作都会记录"],
    "Play music from SoundCloud in your voice channel": ["Reproduce música de SoundCloud en tu canal de voz", "Jouez de la musique SoundCloud dans votre salon vocal", "Spiele SoundCloud-Musik in deinem Sprachkanal", "Toque músicas do SoundCloud no seu canal de voz", "Riproduci musica da SoundCloud nel tuo canale vocale", "Музыка из SoundCloud в вашем голосовом канале", "Odtwarzaj muzykę z SoundCloud na kanale głosowym", "Ses kanalında SoundCloud müziği çal", "ボイスチャンネルでSoundCloudの音楽を再生", "음성 채널에서 SoundCloud 음악 재생", "在语音频道播放 SoundCloud 音乐"],
    "Play a SoundCloud link or search for a song": ["Reproduce un enlace de SoundCloud o busca una canción", "Lancez un lien SoundCloud ou cherchez un titre", "Spiele einen SoundCloud-Link oder suche einen Song", "Toque um link do SoundCloud ou busque uma música", "Riproduci un link SoundCloud o cerca un brano", "Включите ссылку SoundCloud или найдите песню", "Odtwórz link SoundCloud lub wyszukaj utwór", "Bir SoundCloud bağlantısı çal veya şarkı ara", "SoundCloudのリンクを再生、または曲を検索", "SoundCloud 링크를 재생하거나 노래 검색", "播放 SoundCloud 链接或搜索歌曲"],
    "Open the big music player for this server": ["Abre el reproductor de música grande de este servidor", "Ouvrir le grand lecteur de musique du serveur", "Öffnet den großen Musikplayer dieses Servers", "Abre o player de música grande deste servidor", "Apri il grande lettore musicale di questo server", "Открыть большой музыкальный плеер сервера", "Otwórz duży odtwarzacz muzyki serwera", "Bu sunucunun büyük müzik oynatıcısını aç", "このサーバーの大きなミュージックプレイヤーを開く", "이 서버의 큰 음악 플레이어 열기", "打开此服务器的大型音乐播放器"],
    "Open the guided menu: browse every command here and run it": ["Abre el menú guiado: explora y ejecuta cada comando", "Ouvrir le menu guidé : parcourez et lancez chaque commande", "Öffnet das geführte Menü: alle Befehle ansehen und ausführen", "Abre o menu guiado: veja e execute cada comando", "Apri il menu guidato: sfoglia ed esegui ogni comando", "Открыть меню: просмотр и запуск любой команды", "Otwórz menu: przeglądaj i uruchamiaj każde polecenie", "Rehberli menüyü aç: tüm komutlara göz at ve çalıştır", "ガイドメニューを開く：すべてのコマンドを見て実行", "안내 메뉴 열기: 모든 명령어를 둘러보고 실행", "打开引导菜单：浏览并运行所有命令"],
    "Language for the bot's buttons and messages": ["Idioma de los botones y mensajes del bot", "Langue des boutons et messages du bot", "Sprache für Schaltflächen und Nachrichten des Bots", "Idioma dos botões e mensagens do bot", "Lingua dei pulsanti e dei messaggi del bot", "Язык кнопок и сообщений бота", "Język przycisków i wiadomości bota", "Botun düğmeleri ve mesajları için dil", "ボットのボタンとメッセージの言語", "봇 버튼과 메시지의 언어", "机器人按钮和消息的语言"]
};
const DESC_BY = Object.fromEntries(Object.entries(DESC).map(([en, v]) => [en, Object.fromEntries(ORDER.map((l, n) => [DISCORD_LOCALE[l], v[n].slice(0, 100)]))]));

/** Adds Discord's description_localizations to every command (and subcommand) whose English description has a translation above. */
export function localizeCommands(list) {
    const walk = o => {
        const t = DESC_BY[o.description];
        if (t && !o.description_localizations) o.description_localizations = t;
        for (const x of o.options ?? []) if (x.type === 1 || x.type === 2) walk(x);
        return o;
    };
    return list.map(c => (c.type && c.type !== 1 ? c : walk(structuredClone(c))));
}
