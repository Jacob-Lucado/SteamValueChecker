// Shared by the Discord commands and the web dashboard.
export const REGIONS = [
    { name: "United States (USD)", value: "US" },
    { name: "United Kingdom (GBP)", value: "GB" },
    { name: "Europe - Germany (EUR)", value: "DE" },
    { name: "Canada (CAD)", value: "CA" },
    { name: "Australia (AUD)", value: "AU" },
    { name: "Brazil (BRL)", value: "BR" },
    { name: "New Zealand (NZD)", value: "NZ" },
    { name: "Switzerland (CHF)", value: "CH" },
    { name: "Sweden (SEK)", value: "SE" },
    { name: "Norway (NOK)", value: "NO" },
    { name: "Poland (PLN)", value: "PL" },
    { name: "Japan (JPY)", value: "JP" },
    { name: "Mexico (MXN)", value: "MX" },
    { name: "India (INR)", value: "IN" },
    { name: "South Korea (KRW)", value: "KR" },
    { name: "Singapore (SGD)", value: "SG" },
    { name: "Hong Kong (HKD)", value: "HK" },
    { name: "Turkey (TRY)", value: "TR" },
    { name: "South Africa (ZAR)", value: "ZA" },
    { name: "Denmark (DKK)", value: "DK" },
    { name: "Czechia (CZK)", value: "CZ" },
    { name: "Thailand (THB)", value: "TH" },
    { name: "Indonesia (IDR)", value: "ID" },
    { name: "Argentina (ARS)", value: "AR" },
    { name: "Chile (CLP)", value: "CL" }
];

export const ALERT_TYPES = [
    { name: "Any sale", value: "any" },
    { name: "A percentage off or more", value: "percent" },
    { name: "A price or lower", value: "price" },
    { name: "All-time low", value: "atl" }
];

/** The newest FanaticalGrabber release that members can get. Raise it once the Chrome Web Store has approved the new version (EXTENSION_LATEST overrides it). */
export const EXTENSION_LATEST = "2.7.0";
/** Where people install FanaticalGrabber: the Chrome Web Store only. */
export const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/fanaticalgrabber/kmbpdeglijkfbkifilcckkeljagcdbnb";
export const FANATICAL_GRABBER_URL = "https://jacob-lucado.github.io/FanaticalGrabber/";
