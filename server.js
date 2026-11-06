const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === KLÍČE ===
const TMDB_KEY = 'bcd898f31f5a923f94ccedb7d9c2b1a7';
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=500';

app.use(cors());

// Pomocné funkce pro dekódování ID
function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').trim();
}

function parseStreamId(cleanId) {
  // Podporuje tvary: tmdb:1234, tmdb:1234:1:2 (TMDB_ID, Season, Episode)
  const parts = cleanId.replace(/^(tmdb:|tmdb%3A)/i, '').split(':');
  return {
    tmdbId: parts[0],
    season: parts[1] || null,
    episode: parts[2] || null
  };
}

// Vyhledání streamů přes Torrentio (pro filmy i seriály) s Real-Debrid
async function getKoreanStreams(imdbId, season = null, episode = null) {
  const streams = [];
  try {
    const isSeries = season && episode;
    const torrentioUrl = isSeries
      ? `https://torrentio.strem.fun/stream/series/${imdbId}:${season}:${episode}.json`
      : `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;

    const res = await axios.get(torrentioUrl, { timeout: 8000 });

    if (res.data && res.data.streams) {
      for (const s of res.data.streams) {
        const titleUpper = (s.title || '').toUpperCase();
        const isCzech = titleUpper.includes('CZ') || titleUpper.includes('CZECH') || titleUpper.includes('DABING') || titleUpper.includes('CS') || titleUpper.includes('TITULKY');
        
        let streamTitle = isCzech ? `🇨🇿 CZ Sub/Dab [${s.title.split('\n')[0]}]` : `🎬 ${s.title.split('\n')[0]}`;
        let streamUrl = s.url;

        if (s.infoHash && RD_TOKEN) {
          streamUrl = `https://torrentio.strem.fun/realdebrid/${RD_TOKEN}/${s.infoHash}/${s.fileIdx || 0}`;
        }

        if (streamUrl) {
          const streamObj = { title: streamTitle, url: streamUrl };
          if (isCzech) streams.unshift(streamObj);
          else streams.push(streamObj);
        }
      }
    }
  } catch (err) {
    console.warn('[Stream Fetch Warning]:', err.message);
  }
  return streams;
}

// Manifest doplňku (Filmy + Seriály + Filtrování podle roků)
const YEAR_OPTIONS = [
  "Vše", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2015-2019", "Starší (před 2015)"
];

const manifest = {
  id: "org.kdrama.cz.nuvio",
  version: "1.0.0",
  name: "K-Movies & K-Dramas (CZ)",
  description: "Korejské filmy a seriály (K-Dramas) s možností filtrování podle roku vydání a Real-Debrid",
  logo: "https://upload.wikimedia.org/wikipedia/commons/0/09/Flag_of_South_Korea.svg",
  background: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "k_movies",
      name: "🇰🇷 Korejské Filmy",
      extra: [
        { name: "genre", isRequired: false, options: YEAR_OPTIONS },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "k_dramas",
      name: "🇰🇷 K-Dramas (Seriály)",
      extra: [
        { name: "genre", isRequired: false, options: YEAR_OPTIONS },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  behaviorHints: { adult: false }
};

app.get('/manifest.json', (req, res) => res.json(manifest));

function parseExtra(extraStr) {
  if (!extraStr) return {};
  const cleaned = extraStr.replace(/\.json$/, '');
  const params = new URLSearchParams(cleaned);
  const res = {};
  for (const [k, v] of params.entries()) res[k] = v;
  return res;
}

// 1. CATALOG ENDPOINT (S filtrováním podle roku)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id: catalogId, extra: extraStr } = req.params;
  const extra = parseExtra(extraStr);
  const { search, genre, skip } = extra;
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

  try {
    const isSeries = type === 'series' || catalogId === 'k_dramas';
    const endpoint = isSeries ? 'discover/tv' : 'discover/movie';
    const yearParamName = isSeries ? 'first_air_date_year' : 'primary_release_year';
    const dateGteName = isSeries ? 'first_air_date.gte' : 'primary_release_date.gte';
    const dateLteName = isSeries ? 'first_air_date.lte' : 'primary_release_date.lte';

    let queryParams = `api_key=${TMDB_KEY}&with_original_language=ko&sort_by=popularity.desc&language=cs-CZ&page=${page}`;

    if (search) {
      const searchEndpoint = isSeries ? 'search/tv' : 'search/movie';
      queryParams = `api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}&language=cs-CZ&page=${page}`;
      var url = `https://api.themoviedb.org/3/${searchEndpoint}?${queryParams}`;
    } else {
      // Zpracování filtru podle roku
      if (genre && genre !== 'Vše') {
        if (/^\d{4}$/.test(genre)) {
          queryParams += `&${yearParamName}=${genre}`;
        } else if (genre === '2015-2019') {
          queryParams += `&${dateGteName}=2015-01-01&${dateLteName}=2019-12-31`;
        } else if (genre.includes('Starší')) {
          queryParams += `&${dateLteName}=2014-12-31`;
        }
      }
      var url = `https://api.themoviedb.org/3/${endpoint}?${queryParams}`;
    }

    console.log(`[Catalog Request] ${url}`);
    const response = await axios.get(url, { timeout: 8000 });
    const metas = [];

    if (response.data && response.data.results) {
      response.data.results.forEach(item => {
        const title = item.title || item.name;
        if (!title) return;

        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : DEFAULT_POSTER;
        const releaseDate = item.release_date || item.first_air_date || '';
        const year = releaseDate.split('-')[0];

        metas.push({
          id: `tmdb:${item.id}`,
          type: isSeries ? "series" : "movie",
          name: title,
          poster: poster,
          description: item.overview || `Hodnocení: ${item.vote_average}/10 | Rok: ${year || '?'}`
        });
      });
    }

    console.log(`[Catalog Success] Odosláno ${metas.length} položek (${isSeries ? 'Series' : 'Movies'}).`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT (Detail filmu nebo seriálu včetněseznamu epizod)
app.get('/meta/:type/:id*', async (req, res) => {
  const { type } = req.params;
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const { tmdbId } = parseStreamId(cleanId);

  const isSeries = type === 'series';
  const endpoint = isSeries ? `tv/${tmdbId}` : `movie/${tmdbId}`;

  try {
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_KEY}&language=cs-CZ`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    if (data && data.id) {
      const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_POSTER;
      const background = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : poster;
      const title = data.title || data.name || data.original_name;

      const metaObj = {
        id: cleanId,
        type: isSeries ? "series" : "movie",
        name: title,
        poster: poster,
        background: background,
        description: data.overview || 'Bez popisu.',
        genres: data.genres ? data.genres.map(g => g.name) : ['K-Drama'],
        releaseInfo: (data.release_date || data.first_air_date || '').split('-')[0]
      };

      // Generování seznamu epizod pro K-Dramas (Seriály)
      if (isSeries && data.seasons) {
        const videos = [];
        data.seasons.forEach(season => {
          if (season.season_number > 0) {
            for (let ep = 1; ep <= season.episode_count; ep++) {
              videos.push({
                id: `${cleanId}:${season.season_number}:${ep}`,
                title: `S${season.season_number}E${ep} - ${ep}. díl`,
                season: season.season_number,
                episode: ep,
                released: season.air_date
              });
            }
          }
        });
        metaObj.videos = videos;
      }

      return res.json({ meta: metaObj });
    }
  } catch (err) {
    console.error('[Meta Error]:', err.message);
  }

  // Záložní odpověď při chybě
  res.json({
    meta: {
      id: cleanId,
      type: isSeries ? "series" : "movie",
      name: "Korejský obsah",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: "Přehrávání videa..."
    }
  });
});

// 3. STREAM ENDPOINT
app.get('/stream/:type/:id*', async (req, res) => {
  const { type } = req.params;
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const { tmdbId, season, episode } = parseStreamId(cleanId);
  const isSeries = type === 'series' || (season && episode);

  try {
    const endpoint = isSeries ? `tv/${tmdbId}/external_ids` : `movie/${tmdbId}/external_ids`;
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_KEY}`, { timeout: 8000 });
    const imdbId = tmdbRes.data?.imdb_id;

    if (!imdbId) {
      return res.json({ streams: [] });
    }

    const streams = await getKoreanStreams(imdbId, season, episode);
    console.log(`[Stream Success] Načteno ${streams.length} streamů pro ${imdbId}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`K-Drama & K-Movie Addon spuštěn na portu ${PORT}`));
