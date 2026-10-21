// ============================================================
//  Единая точка конфигурации внешних данных.
//  Все источники работают прямо из браузера (CORS ✓) и без ключей.
// ============================================================

const API = {
  // Викицитатник на русском — основной источник (MediaWiki API, CORS *)
  wikiquote: {
    random: () =>
      "https://ru.wikiquote.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=5&format=json&origin=*",
    parse: (title) =>
      `https://ru.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*`,
  },

  // Короткие мудрые советы (английский, переводится автоматически)
  advice: (t) => `https://api.adviceslip.com/advice?t=${t}`,

  // Большая коллекция цитат (английский, переводится автоматически)
  quotes: "https://dummyjson.com/quotes",

  // Автоперевод с английского на русский (бесплатный, без ключа)
  translate: (text) =>
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`,

  // Спокойная фоновая музыка: случайный трек из каталога SoundHelix
  musicTracks: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3",
  ],
};
