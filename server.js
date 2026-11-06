const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

const TMDB_KEY = 'bcd898f31f5a923f94ccedb7d9c2b1a7';
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=500';

app.use(cors());

function extractCleanId(rawParamId) {
  if (!rawParamId) return '';
  let decoded = decodeURIComponent(rawParamId);
  return decoded.replace(/\.json$/, '').replace(/^(tmdb:|tmdb%3A)/i, '').trim();
}

async function getKoreanMovieStreams(imdbId) {
  const streams = [];
  try {
    const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
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
  } catch (err) {}
  return streams;
}

const YEAR_OPTIONS = ["Vše", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2015-2019", "Starší (před 2015)"];

const manifest = {
  id: "org.kmovies.cz.nuvio",
  version: "2.0.0",
  name: "🇰🇷 Korejské Filmy (CZ)",
  description: "Korejské filmy s filtrováním podle roku a Real-Debrid",
  logo: "https://upload.wikimedia.org/wikipedia/commons/0/09/Flag_of_South_Korea.svg",
  background: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "k_movies_cat",
      name: "🇰🇷 Korejské Filmy",
      extra: [
        { name: "genre", isRequired: false, options: YEAR_OPTIONS },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};

app.get('/manifest.json', (req, res) => res.json(manifest));

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const extraStr = req.params.extra || '';
  const params = new URLSearchParams(extraStr.replace(/\.json$/, ''));
  const search = params.get('search');
  const genre = params.get('genre');
  const skip = params.get('skip');
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

  try {
    let queryParams = `api_key=${TMDB_KEY}&with_original_language=ko&sort_by=popularity.desc&language=cs-CZ&page=${page}`;
    let url = `https://api.themoviedb.org/3/discover/movie?${queryParams}`;

    if (search) {
      url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}&language=cs-CZ&page=${page}`;
    } else if (genre && genre !== 'Vše') {
      if (/^\d{4}$/.test(genre)) queryParams += `&primary_release_year=${genre}`;
      else if (genre === '2015-2019') queryParams += `&primary_release_date.gte=2015-01-01&primary_release_date.lte=2019-12-31`;
      else if (genre.includes('Starší')) queryParams += `&primary_release_date.lte=2014-12-31`;
      url = `https://api.themoviedb.org/3/discover/movie?${queryParams}`;
    }

    const response = await axios.get(url, { timeout: 8000 });
    const metas = [];

    if (response.data && response.data.results) {
      response.data.results.forEach(item => {
        if (!item.title) return;
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : DEFAULT_POSTER;
        metas.push({
          id: `tmdb:${item.id}`,
          type: "movie",
          name: item.title,
          poster: poster,
          description: item.overview || `Hodnocení: ${item.vote_average}/10`
        });
      });
    }
    res.json({ metas });
  } catch (err) {
    res.json({ metas: [] });
  }
});

app.get('/meta/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const tmdbId = extractCleanId(rawIdParam);

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=cs-CZ`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    if (data && data.id) {
      const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_POSTER;
      const background = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : poster;

      return res.json({
        meta: {
          id: `tmdb:${data.id}`,
          type: "movie",
          name: data.title || data.original_title,
          poster: poster,
          background: background,
          description: data.overview || 'Bez popisu.',
          genres: data.genres ? data.genres.map(g => g.name) : ['K-Movie'],
          releaseInfo: (data.release_date || '').split('-')[0]
        }
      });
    }
  } catch (err) {}

  res.json({
    meta: { id: `tmdb:${tmdbId}`, type: "movie", name: "Korejský film", poster: DEFAULT_POSTER, background: DEFAULT_POSTER, description: "Přehrávání..." }
  });
});

app.get('/stream/:type/:id*', async (req, res) => {
  const rawIdParam = req.params.id + (req.params[0] || '');
  const tmdbId = extractCleanId(rawIdParam);

  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`, { timeout: 8000 });
    const imdbId = tmdbRes.data?.imdb_id;

    if (!imdbId) return res.json({ streams: [] });
    const streams = await getKoreanMovieStreams(imdbId);
    res.json({ streams });
  } catch (err) {
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`K-Movies Addon v2.0.0 spuštěn`));
