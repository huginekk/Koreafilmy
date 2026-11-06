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
  const parts = cleanId.replace(/^(tmdb:|tmdb%3A)/i, '').split(':');
  return {
    tmdbId: parts[0],
    season: parts[1] || null,
    episode: parts[2] || null
  };
}

// Bezpečné načtení dat z TMDB s automatickým přechodem mezi TV a Movie
async function fetchTmdbMeta(tmdbId, preferredType) {
  const isPrefSeries = preferredType === 'series';
  const primaryEndpoint = isPrefSeries ? `tv/${tmdbId}` : `movie/${tmdbId}`;
  const secondaryEndpoint = isPrefSeries ? `movie/${tmdbId}` : `tv/${tmdbId}`;

  try {
    const res = await axios.get(`https://api.themoviedb.org/3/${primaryEndpoint}?api_key=${TMDB_KEY}&language=cs-CZ`, { timeout: 7000 });
    if (res.data && res.data.id) {
      return { data: res.data, actualType: isPrefSeries ? 'series' : 'movie' };
    }
  } catch (e) {
    try {
      const res2 = await axios.get(`https://api.themoviedb.org/3/${secondaryEndpoint}?api_key=${TMDB_KEY}&language=cs-CZ`, { timeout: 7000 });
      if (res2.data && res2.data.id) {
        return { data: res2.data, actualType: isPrefSeries ? 'movie' : 'series' };
      }
    } catch (e2) {}
  }
  return null;
}

// Vyhledání streamů přes Torrentio
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

const YEAR_OPTIONS = [
  "Vše", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2015-2019", "Starší (před 2015)"
];

const manifest = {
  id: "org.kdrama.cz.nuvio",
  version: "1.1.0",
  name: "K-Movies & K-Dramas (CZ)",
  description: "Korejské filmy a seriály (K-Dramas) s filtrováním podle roku a Real-Debrid",
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

// 1. CATALOG ENDPOINT
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

    console.log(`[Catalog Success] Odosláno ${metas.length} položek.`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT (S garancí struktury pro Nuvio)
app.get('/meta/:type/:id*', async (req, res) => {
  const { type } = req.params;
  const rawIdParam = req.params.id + (req.params[0] || '');
  const cleanId = extractCleanId(rawIdParam);
  const { tmdbId } = parseStreamId(cleanId);

  const tmdbResult = await fetchTmdbMeta(tmdbId, type);

  if (tmdbResult) {
    const { data, actualType } = tmdbResult;
    const isSeries = actualType === 'series' || type === 'series';
    const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_POSTER;
    const background = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : poster;
    const title = data.title || data.name || data.original_name || data.original_title;

    const metaObj = {
      id: cleanId,
      type: type || actualType,
      name: title,
      poster: poster,
      background: background,
      description: data.overview || 'Bez popisu.',
      genres: data.genres ? data.genres.map(g => g.name) : ['K-Drama'],
      releaseInfo: (data.release_date || data.first_air_date || '').split('-')[0]
    };

    if (isSeries) {
      const videos = [];
      if (data.seasons && data.seasons.length > 0) {
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
      }
      
      // Fallback epizoda, aby Nuvio nikdy nespadlo na "Error getting meta"
      if (videos.length === 0) {
        videos.push({
          id: `${cleanId}:1:1`,
          title: `S1E1 - 1. díl`,
          season: 1,
          episode: 1
        });
      }
      metaObj.videos = videos;
    }

    return res.json({ meta: metaObj });
  }

  // Záložní odpověď garantující strukturu
  const isFallbackSeries = type === 'series';
  const fallbackMeta = {
    id: cleanId,
    type: type || "movie",
    name: "Korejský titul",
    poster: DEFAULT_POSTER,
    background: DEFAULT_POSTER,
    description: "Přehrávání obsahu..."
  };

  if (isFallbackSeries) {
    fallbackMeta.videos = [
      {
        id: `${cleanId}:1:1`,
        title: "S1E1 - 1. díl",
        season: 1,
        episode: 1
      }
    ];
  }

  return res.json({ meta: fallbackMeta });
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
    let imdbId = null;

    try {
      const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_KEY}`, { timeout: 6000 });
      imdbId = tmdbRes.data?.imdb_id;
    } catch (e) {
      const altEndpoint = isSeries ? `movie/${tmdbId}/external_ids` : `tv/${tmdbId}/external_ids`;
      try {
        const tmdbRes2 = await axios.get(`https://api.themoviedb.org/3/${altEndpoint}?api_key=${TMDB_KEY}`, { timeout: 6000 });
        imdbId = tmdbRes2.data?.imdb_id;
      } catch (e2) {}
    }

    if (!imdbId) {
      return res.json({ streams: [] });
    }

    const streams = await getKoreanStreams(imdbId, season, episode);
    console.log(`[Stream Success] Načteno ${streams.length} streamů pro ${imdbId}`);
    return res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    return res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`K-Drama Addon v1.1.0 spuštěn na portu ${PORT}`));
                   
