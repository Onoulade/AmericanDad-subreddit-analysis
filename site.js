"use strict";

const data = window.QUOTE_INDEX;
const byId = id => document.getElementById(id);

if (data) {
  start(data);
} else {
  byId("overview-note").textContent = "The data snapshot could not load. Keep all the generated files together.";
}

function start({episodes, quotes, activity, built, subreddit, illustrated_quotes, post_formats}) {
  const nf = new Intl.NumberFormat("en-US", {maximumFractionDigits: 1});
  const monthFormat = new Intl.DateTimeFormat("en-US", {month: "short", year: "numeric", timeZone: "UTC"});
  const dayFormat = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"});
  const axisDayFormat = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
  const scoreFormat = new Intl.NumberFormat("en-US", {maximumFractionDigits: 1, minimumFractionDigits: 1});
  const formatMonth = key => key.length === 4 ? key : monthFormat.format(new Date(key + "-01T00:00:00Z"));
  const formatDay = key => dayFormat.format(new Date(key + "T00:00:00Z"));
  const formatPeriod = key => key.length === 10 ? "Week of " + formatDay(key) : formatMonth(key);
  const percent = (value, digits = 1) => value === null ? "—" : `${value.toFixed(digits)}%`;
  const share = (part, total) => total ? 100 * part / total : null;
  const averageScore = row => row?.scored ? row.scoreTotal / row.scored : null;
  const median = values => {
    const ordered = [...values].sort((a, b) => a - b);
    const mid = Math.floor(ordered.length / 2);
    return ordered.length ? (ordered[mid] + ordered[Math.floor((ordered.length - 1) / 2)]) / 2 : null;
  };
  const count = (value, singular, plural = singular + "s") => `${nf.format(value)} ${value === 1 ? singular : plural}`;
  const quoteTitle = index => `“${quotes[index][1].replace(/^["“](.*)["”]$/s, "$1")}”`;
  const focusParts = key => [key[0], Number(key.slice(1))];
  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const searchKey = value => String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/\p{Mark}/gu, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  const seasons = new Map();
  episodes.forEach((episode, index) => {
    if (!seasons.has(episode.season)) seasons.set(episode.season, new Map());
    seasons.get(episode.season).set(episode.episode, index);
  });
  const episodeWords = episodes.map(e => searchKey(`${e.title} ${e.episode_id} ${e.season}x${e.episode} season ${e.season} episode ${e.episode}`).split(" "));
  const quoteTokens = quotes.map(([, line]) => " " + searchKey(line));

  const illustrated = new Set(illustrated_quotes);
  const snapshotMonths = [...new Set(activity.map(([day]) => day.slice(0, 7)).filter(Boolean))].sort();
  const months = [];
  if (snapshotMonths.length) {
    const cursor = new Date(snapshotMonths[0] + "-01T00:00:00Z");
    const lastMonth = snapshotMonths.at(-1);
    while (cursor.toISOString().slice(0, 7) <= lastMonth) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const seasonSelect = byId("season");
  const from = byId("date-from");
  const through = byId("date-through");
  const quickQuery = byId("quick-query");
  const quickResults = byId("quick-results");
  const randomButton = byId("random-quote");
  const rerollButton = byId("quick-reroll");
  const search = byId("search");
  const sort = byId("sort");
  const focusSelect = byId("trend-focus");
  const pointSelect = byId("trend-point");
  const canvas = byId("trend-chart");
  const grid = byId("heat-grid");
  const episodeQuoteSearch = byId("episode-quotes-search");
  const episodeQuoteSort = byId("episode-quotes-sort");
  const episodeQuoteSize = byId("episode-quotes-size");
  const episodeQuotePageSelect = byId("episode-quotes-page");
  const episodeQuotePrev = byId("episode-quotes-prev");
  const episodeQuoteNext = byId("episode-quotes-next");
  const PAGE_SIZE = 10;
  const sorts = {
    quotes: [["posts", "Most posts"], ["name", "Line A–Z"]],
    episodes: [["posts", "Most posts"], ["distinct", "Most distinct lines"], ["code", "Season and episode"], ["name", "Episode A–Z"]],
    coverage: [["coverage", "Highest coverage"], ["cues", "Most cues quoted"], ["code", "Season and episode"]],
  };

  let mode = "quotes";
  let page = 0;
  let focus = "";
  let heatCursor = null;
  let chartSeries = [];
  let chartPoint = -1;
  let randomQuote = null;
  let episodeQuoteIndex = null;
  let episodeQuotePage = 0;
  let stats;
  let selected;

  function option(value, label = value) {
    return new Option(label, value);
  }

  for (const season of seasons.keys()) seasonSelect.add(option(String(season), `Season ${season}`));
  from.add(option("", "First month"));
  through.add(option("", "Latest month"));
  for (const month of months) {
    from.add(option(month, formatMonth(month)));
    through.add(option(month, formatMonth(month)));
  }

  function filterState() {
    const season = seasonSelect.value ? Number(seasonSelect.value) : null;
    const hasDateFilter = Boolean(from.value || through.value);
    const includesMonth = month => !hasDateFilter || Boolean(month)
      && (!from.value || month >= from.value) && (!through.value || month <= through.value);
    return {season, includesMonth, months: months.filter(includesMonth)};
  }

  function aggregate({season, includesMonth}) {
    const activeEpisodes = episodes.map((episode, idx) => season === null || episode.season === season ? idx : -1)
      .filter(idx => idx >= 0);
    const allowed = new Set(activeEpisodes);
    const ep = episodes.map(() => ({posts: 0, cues: new Set(), distinct: 0, scoreTotal: 0, scored: 0}));
    const lines = new Map();
    let posts = 0;
    const daily = new Map();
    const addScore = (row, score) => {
      if (score === null) return;
      row.scoreTotal += score;
      row.scored++;
    };
    for (const [day, ei, qi, cues, score, comments] of activity) {
      if (!allowed.has(ei) || !includesMonth(day.slice(0, 7))) continue;
      ep[ei].posts++;
      addScore(ep[ei], score);
      posts++;
      daily.set(day, (daily.get(day) ?? 0) + 1);
      for (const cue of cues) ep[ei].cues.add(cue);
      if (!lines.has(qi)) {
        lines.set(qi, {
          index: qi, posts: 0, scoreTotal: 0, scored: 0, peakScore: null, comments: null, first: "", last: "",
        });
        ep[ei].distinct++;
      }
      const line = lines.get(qi);
      line.posts++;
      addScore(line, score);
      if (score !== null && (line.peakScore === null || score > line.peakScore)) line.peakScore = score;
      if (typeof comments === "number") line.comments = (line.comments ?? 0) + comments;
      if (day) {
        if (!line.first || day < line.first) line.first = day;
        if (day > line.last) line.last = day;
      }
    }
    const orderedQuotes = [...lines.values()].sort((a, b) => b.posts - a.posts || a.index - b.index);
    const orderedEpisodes = [...activeEpisodes].sort((a, b) => ep[b].posts - ep[a].posts || a - b);
    const subtitleCues = activeEpisodes.reduce((sum, index) => sum + (episodes[index].subtitle_cues ?? 0), 0);
    const touchedCues = activeEpisodes.reduce((sum, index) => sum + ep[index].cues.size, 0);
    return {ep, lines, activeEpisodes, orderedQuotes, orderedEpisodes, subtitleCues, touchedCues, posts, daily};
  }

  function renderOverview() {
    const all = aggregate({season: null, includesMonth: () => true});
    const trackCount = episodes.filter(episode => episode.subtitle_cues).length;
    const episodesQuoted = all.ep.filter(episode => episode.posts > 0).length;
    const topTenPosts = all.orderedEpisodes.slice(0, 10).reduce((sum, index) => sum + all.ep[index].posts, 0);
    const extras = renderCharts(all) ?? {};
    const metrics = [
      [nf.format(all.posts), "Quote posts analyzed"],
      [nf.format(all.orderedQuotes.length), "Distinct lines posted"],
      [`${nf.format(episodesQuoted)}<small>/${nf.format(episodes.length)}</small>`, "Episodes quoted"],
      [percent(share(all.touchedCues, all.subtitleCues)), "Of indexed dialogue proved memeable"],
      [extras.medianScore === null || extras.medianScore === undefined ? "—" : nf.format(extras.medianScore), "Median Reddit score"],
      [extras.medianAge === null || extras.medianAge === undefined ? "—" : `${scoreFormat.format(extras.medianAge)}<small>yrs</small>`, "Median episode age when quoted"],
    ];
    byId("subreddit").textContent = "r/" + subreddit + " quote recap";
    const first = snapshotMonths[0];
    const last = snapshotMonths.at(-1);
    byId("snapshot").textContent = (first ? `${formatMonth(first)} – ${formatMonth(last)} · ` : "") + `Updated ${formatDay(built)}`;
    byId("kpis").innerHTML = metrics.map(([number, label]) => `<div><dt>${safe(label)}</dt><dd>${number}</dd></div>`).join("");
    byId("overview-note").textContent = `Every post here was matched to a specific line. The dialogue estimate uses ${count(trackCount, "mapped subtitle track")}.`;
    const leaders = all.orderedQuotes.slice(0, 20);
    const bestCount = leaders[0]?.posts ?? 1;
    const leaderPosts = leaders.reduce((sum, entry) => sum + entry.posts, 0);
    byId("top-lines-summary").textContent = leaders.length
      ? `Ranked by matched post count on r/${subreddit}. These ${nf.format(leaders.length)} lines account for ${count(leaderPosts, "post")}, or ${percent(share(leaderPosts, all.posts))} of all analyzed quote posts.`
      : "No quote posts in the archive yet.";
    byId("quote-gallery").innerHTML = leaders.map(({index, posts}, position) => {
      const [ei, , id] = quotes[index];
      const e = episodes[ei];
      const rank = leaders.findIndex(line => line.posts === posts) + 1;
      return `<li class="quote-card" id="quote-position-${position + 1}">
        ${illustrated.has(id) ? `<img class="quote-frame" src="./images/${safe(id)}.webp" alt="" loading="lazy" decoding="async">` : ""}
        <div class="quote-card-copy">
          <p class="quote-rank"><span>#${rank} by post count</span><strong>${safe(count(posts, "post"))}</strong></p>
          <h3><button type="button" class="card-link" data-focus="q${index}">${safe(quoteTitle(index))}</button></h3>
          <p class="quote-episode">${safe(e.episode_id)} · ${safe(e.title)}</p>
          <span class="quote-bar" style="--quote-share:${100 * posts / bestCount}%" aria-hidden="true"></span>
        </div>
      </li>`;
    }).join("");
    for (const link of document.querySelectorAll('.quote-jumps a[href^="#quote-position-"]')) {
      link.hidden = !document.getElementById(link.hash.slice(1));
    }
    const topEpisode = all.orderedEpisodes[0];
    const mostDistinct = [...all.orderedEpisodes].sort((a, b) => all.ep[b].distinct - all.ep[a].distinct || a - b)[0];
    const feature = (label, number, title, meta, key, imageId) => `<article class="feature">
      <h3 class="feature-label">${safe(label)}</h3>
      <div class="feature-result">
        <p class="feature-number">${safe(number)}</p>
        ${illustrated.has(imageId) ? `<img class="feature-still" src="./images/${safe(imageId)}.webp" alt="" loading="lazy" decoding="async">` : ""}
      </div>
      <p class="feature-name">${key ? `<button class="card-link" type="button" data-focus="${key}">${safe(title)}</button>` : safe(title)}</p>
      <p class="feature-meta">${safe(meta)}</p>
    </article>`;
    const mostPopular = all.orderedQuotes[0];
    const best = extras.best;
    const features = all.posts ? [
      feature("Most posted line", nf.format(mostPopular.posts), episodes[quotes[mostPopular.index][0]].title,
        "Posts quoting the winning line", "q" + mostPopular.index),
      feature("Most quoted episode", nf.format(all.ep[topEpisode].posts), episodes[topEpisode].title,
        `Quote posts across ${count(all.ep[topEpisode].distinct, "line")}`, "e" + topEpisode),
      best ? feature("Highest-scoring post", nf.format(best[4]), quoteTitle(best[2]),
        `Reddit points · ${episodes[best[1]].title}`, "q" + best[2], quotes[best[2]][2])
        : feature("Most distinct lines", nf.format(all.ep[mostDistinct].distinct), episodes[mostDistinct].title,
          "Different lines quoted", "e" + mostDistinct),
    ] : [];
    byId("features").innerHTML = all.posts ? features.join("") +
      `<p class="feature-note">The ten most quoted episodes account for ${percent(share(topTenPosts, all.posts))} of quote posts.</p>` : "";
  }

  function searchMatches(query) {
    const terms = query.split(" ").filter(Boolean);
    const matchingEpisodes = episodeWords.map(words => terms.every(term => words.some(word => word.startsWith(term))));
    return {
      episode: index => matchingEpisodes[index],
      quote: index => quoteTokens[index].includes(" " + query) || matchingEpisodes[quotes[index][0]],
    };
  }

  function episodeSummary(index) {
    const {posts, distinct, cues} = stats.ep[index];
    const coverage = share(cues.size, episodes[index].subtitle_cues);
    const details = [count(posts, "post"), count(distinct, "distinct line")];
    if (coverage !== null) details.push(percent(coverage) + " dialogue coverage");
    return details.join(" · ");
  }

  function quoteSummary(index, posts) {
    const portion = share(posts, stats.ep[quotes[index][0]].posts);
    return count(posts, "post") + (portion === null ? "" : ` · ${percent(portion)} of the episode’s quote posts`);
  }

  function renderQuickSearch() {
    randomButton.disabled = !stats.orderedQuotes.length;
    const query = searchKey(quickQuery.value);
    const surprise = randomQuote === null ? null : stats.orderedQuotes.find(line => line.index === randomQuote);
    quickResults.hidden = !query && !surprise;
    if (quickResults.hidden) return;

    const result = (key, name, detail) => `<li><button type="button" class="row-link" data-focus="${key}">${safe(name)}</button>
      <span class="row-meta">${safe(detail)}</span></li>`;
    const quoteResult = ({index, posts}) => {
      const e = episodes[quotes[index][0]];
      return result("q" + index, quoteTitle(index), `${e.episode_id} · ${e.title} · ${quoteSummary(index, posts)}`);
    };
    const episodeResult = index => {
      const e = episodes[index];
      return result("e" + index, e.title, `${e.episode_id} · ${episodeSummary(index)}`);
    };
    const group = (label, rows, render, resultMode) => {
      if (!rows.length) return "";
      const limit = 5;
      return `<div class="quick-group"><h4>${safe(label)}</h4><ul>${rows.slice(0, limit).map(render).join("")}</ul>
        ${rows.length > limit ? `<button type="button" class="text-button" data-results="${resultMode}">See all ${count(rows.length, resultMode === "quotes" ? "quote" : "episode")} ↘</button>` : ""}</div>`;
    };
    const status = byId("quick-status");
    const columns = byId("quick-columns");
    byId("quick-title").textContent = surprise ? "Quote roulette" : "Search results";
    status.classList.toggle("sr-only", Boolean(surprise));
    rerollButton.hidden = !surprise;
    if (surprise) {
      status.textContent = quoteTitle(surprise.index);
      columns.innerHTML = group("Quoted line", [surprise], quoteResult, "quotes");
      return;
    }
    const matches = searchMatches(query);
    const exactEpisode = index => searchKey(episodes[index].title) === query || episodes[index].episode_id.toLowerCase() === query;
    const exactQuote = ({index}) => quoteTokens[index] === " " + query;
    const foundEpisodes = stats.orderedEpisodes.filter(matches.episode).sort((a, b) => Number(exactEpisode(b)) - Number(exactEpisode(a)));
    const foundQuotes = stats.orderedQuotes.filter(({index}) => matches.quote(index)).sort((a, b) => Number(exactQuote(b)) - Number(exactQuote(a)));
    status.textContent = foundQuotes.length || foundEpisodes.length
      ? `${count(foundQuotes.length, "quote")} · ${count(foundEpisodes.length, "episode")}`
      : "No matches. Try a few words from the quote, an episode title, or an episode code.";
    columns.innerHTML = group("Quotes", foundQuotes, quoteResult, "quotes")
      + group("Episodes", foundEpisodes, episodeResult, "episodes");
  }

  function renderRanking() {
    const matches = searchMatches(searchKey(search.value));
    const isQuote = mode === "quotes";
    const coverage = index => share(stats.ep[index].cues.size, episodes[index].subtitle_cues);
    let rows;
    let heading;
    let cells;
    if (isQuote) {
      heading = [["Line"], ["Posts", true], ["Episode quote share", true]];
      rows = stats.orderedQuotes.filter(line => matches.quote(line.index));
      if (sort.value === "name") rows.sort((a, b) => quotes[a.index][1].localeCompare(quotes[b.index][1]) || a.index - b.index);
      cells = ({index, posts}) => {
        const e = episodes[quotes[index][0]];
        return [rowTitle(quoteTitle(index), `${e.episode_id} · ${e.title}`, "q" + index),
          numberCell(nf.format(posts)), numberCell(percent(share(posts, stats.ep[quotes[index][0]].posts)))];
      };
    } else {
      rows = stats.orderedEpisodes.filter(matches.episode);
      const title = index => rowTitle(episodes[index].title, episodes[index].episode_id, "e" + index);
      if (mode === "episodes") {
        heading = [["Episode"], ["Posts", true], ["Distinct lines", true], ["Share of ranked posts", true]];
        cells = index => [title(index), numberCell(nf.format(stats.ep[index].posts)),
          numberCell(nf.format(stats.ep[index].distinct)), numberCell(percent(share(stats.ep[index].posts, stats.posts)))];
      } else {
        heading = [["Episode"], ["Cues quoted", true], ["Subtitle cues", true], ["Coverage", true]];
        cells = index => [title(index), numberCell(episodes[index].subtitle_cues ? nf.format(stats.ep[index].cues.size) : "—"),
          numberCell(episodes[index].subtitle_cues === null ? "—" : nf.format(episodes[index].subtitle_cues)),
          numberCell(percent(coverage(index)))];
      }
      const compare = {
        distinct: (a, b) => stats.ep[b].distinct - stats.ep[a].distinct || stats.ep[b].posts - stats.ep[a].posts || a - b,
        coverage: (a, b) => (coverage(b) ?? -1) - (coverage(a) ?? -1) || a - b,
        cues: (a, b) => stats.ep[b].cues.size - stats.ep[a].cues.size || (coverage(b) ?? -1) - (coverage(a) ?? -1) || a - b,
        code: (a, b) => a - b,
        name: (a, b) => episodes[a].title.localeCompare(episodes[b].title) || a - b,
      }[sort.value];
      if (compare) rows.sort(compare);
    }

    const pages = Math.ceil(rows.length / PAGE_SIZE);
    page = Math.min(page, Math.max(0, pages - 1));
    const start = page * PAGE_SIZE;
    byId("ranking-head").innerHTML = `<tr><th scope="col">#</th>${heading.map(([label, numeric]) =>
      `<th scope="col"${numeric ? ' class="num"' : ""}>${safe(label)}</th>`).join("")}</tr>`;
    byId("ranking-body").innerHTML = rows.slice(start, start + PAGE_SIZE).map((row, index) =>
      `<tr><td>${nf.format(start + index + 1)}</td>${cells(row).join("")}</tr>`).join("");
    byId("search-empty").hidden = rows.length > 0;
    byId("search-empty").textContent = "No results for these filters.";
    byId("page-label").textContent = rows.length
      ? `${nf.format(start + 1)}–${nf.format(Math.min(start + PAGE_SIZE, rows.length))} of ${count(rows.length, "result")}`
      : "0 results";
    byId("prev").disabled = !page;
    byId("next").disabled = page + 1 >= pages;
  }

  function rowTitle(label, meta, key) {
    return `<td><button type="button" class="row-link" data-focus="${key}">${safe(label)}</button><span class="row-meta">${safe(meta)}</span></td>`;
  }

  function numberCell(value) {
    return `<td class="num">${safe(value)}</td>`;
  }

  function renderHeatmap() {
    const metric = byId("heat-metric").value;
    const metricValue = index => metric === "coverage" ? share(stats.ep[index].cues.size, episodes[index].subtitle_cues)
      : stats.ep[index][metric];
    const max = Math.max(0, ...stats.activeEpisodes.map(metricValue));
    const visibleSeasons = [...seasons].filter(([season]) => selected.season === null || selected.season === season);
    const maxNumber = Math.max(1, ...visibleSeasons.flatMap(([, row]) => [...row.keys()]));
    const coordinate = (label, season = false) => `<span class="map-coordinate${season ? " map-season" : ""}" aria-hidden="true">${safe(label)}</span>`;
    const description = index => {
      const episode = episodes[index];
      const {posts, distinct, cues} = stats.ep[index];
      const coverage = share(cues.size, episode.subtitle_cues);
      return `${episode.episode_id} · ${episode.title} · ${count(posts, "post")} · ${count(distinct, "distinct line")} · ${coverage === null ? "No mapped subtitle track" : percent(coverage) + " dialogue coverage"}`;
    };
    heatCursor = stats.activeEpisodes.includes(heatCursor) ? heatCursor : stats.activeEpisodes[0];
    let tiles = coordinate("Season") + Array.from({length: maxNumber}, (_, i) => coordinate(i + 1)).join("");
    for (const [season, row] of visibleSeasons) {
      tiles += coordinate("S" + String(season).padStart(2, "0"), true);
      for (let episode = 1; episode <= maxNumber; episode++) {
        const index = row.get(episode);
        if (index === undefined) {
          tiles += coordinate("");
          continue;
        }
        const value = metricValue(index);
        const level = value === null ? "na" : value === 0 ? 0 : Math.ceil(7 * value / max);
        tiles += `<button class="heat-tile" type="button" data-index="${index}" data-focus="e${index}"
          data-level="${level}" aria-label="${safe(description(index))}" title="${safe(description(index))}"
          tabindex="${index === heatCursor ? 0 : -1}" aria-current="${focus === "e" + index}"></button>`;
      }
    }
    grid.style.gridTemplateColumns = `46px repeat(${maxNumber}, minmax(22px, 1fr))`;
    grid.innerHTML = tiles;
    byId("heat-detail").textContent = stats.activeEpisodes.length
      ? "Focus or hover on an episode to see its title and counts."
      : "No episodes in view.";
    const swatches = [0, 1, 2, 3, 4, 5, 6, 7].map(level => `<span class="swatch" data-level="${level}" aria-hidden="true"></span>`).join("");
    byId("heat-legend").innerHTML = `<span>0</span>${swatches}<span>${metric === "coverage" ? percent(max) : nf.format(max)}</span>`
      + (metric === "coverage" ? '<span class="swatch legend-gap" data-level="na" aria-hidden="true"></span><span>No mapped track</span>' : "");
  }

  function renderFocus() {
    const episodeOptions = new Map(stats.orderedEpisodes.filter(index => stats.ep[index].posts > 0).slice(0, 25)
      .map(index => ["e" + index, `${episodes[index].episode_id} · ${episodes[index].title}`]));
    const lineOptions = new Map(stats.orderedQuotes.slice(0, 25)
      .map(({index}) => ["q" + index, quoteTitle(index)]));
    if (focus) {
      const [type, index] = focusParts(focus);
      const epIndex = type === "e" ? index : quotes[index][0];
      if (!stats.activeEpisodes.includes(epIndex)) focus = "";
      else if (type === "e") episodeOptions.set(focus, `${episodes[index].episode_id} · ${episodes[index].title}`);
      else lineOptions.set(focus, quoteTitle(index));
    }
    const group = (label, choices) => {
      const element = document.createElement("optgroup");
      element.label = label;
      for (const [key, name] of choices) element.append(option(key, name));
      return element;
    };
    focusSelect.replaceChildren(option("", "All matched posts in view"));
    if (episodeOptions.size) focusSelect.append(group("Episodes", episodeOptions));
    if (lineOptions.size) focusSelect.append(group("Quoted lines", lineOptions));
    focusSelect.value = focus;
    const active = grid.querySelector('[aria-current="true"]');
    if (active) active.setAttribute("aria-current", "false");
    const tile = focus ? grid.querySelector(`[data-focus="${focus}"]`) : null;
    if (tile) tile.setAttribute("aria-current", "true");
  }

  function renderDetail() {
    byId("trend-stats").hidden = !focus;
    byId("episode-quotes").hidden = !focus;
    if (!focus) return;
    const [type, index] = focusParts(focus);
    const isEpisode = type === "e";
    const ei = isEpisode ? index : quotes[index][0];
    const episode = episodes[ei];
    const row = isEpisode ? stats.ep[ei] : stats.lines.get(index);
    const posts = row?.posts ?? 0;
    const ahead = isEpisode
      ? stats.orderedEpisodes.filter(i => stats.ep[i].posts > posts).length
      : stats.orderedQuotes.filter(line => line.posts > posts).length;
    const metrics = [
      ["Quote posts", nf.format(posts)],
      [isEpisode ? "Episode rank in view" : "Line rank in view", posts ? "#" + nf.format(ahead + 1) : "—"],
      [isEpisode ? "Share of quote posts in view" : "Share of this episode’s quote posts",
        percent(share(posts, isEpisode ? stats.posts : stats.ep[ei].posts))],
      ["Average Reddit score", averageScore(row) === null ? "—" : scoreFormat.format(averageScore(row))],
    ];
    if (isEpisode) {
      metrics.push(["Distinct lines", nf.format(row.distinct)],
        ["Indexed dialogue quoted", percent(share(row.cues.size, episode.subtitle_cues))]);
    }
    byId("trend-item").textContent = isEpisode ? episode.title : quoteTitle(index);
    byId("trend-context").textContent = isEpisode ? episode.episode_id : `${episode.episode_id} · ${episode.title}`;
    const episodeLink = byId("episode-detail-link");
    episodeLink.hidden = isEpisode;
    episodeLink.dataset.focus = "e" + ei;
    byId("episode-quotes-link").textContent = `Browse ${count(stats.ep[ei].distinct, "episode quote")} ↓`;
    const image = byId("trend-image");
    const imageId = isEpisode ? null : quotes[index][2];
    image.hidden = !illustrated.has(imageId);
    if (image.hidden) image.removeAttribute("src");
    else image.src = `./images/${imageId}.webp`;
    byId("trend-metrics").innerHTML = metrics.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join("");
    if (episodeQuoteIndex !== ei) {
      episodeQuoteIndex = ei;
      episodeQuotePage = 0;
      episodeQuoteSearch.value = "";
      episodeQuoteSort.value = "posts";
    }
    renderEpisodeQuotes();
  }

  function renderEpisodeQuotes() {
    const episode = episodes[episodeQuoteIndex];
    const episodeStats = stats.ep[episodeQuoteIndex];
    const query = searchKey(episodeQuoteSearch.value);
    let rank = 0;
    const rows = stats.orderedQuotes.filter(line => quotes[line.index][0] === episodeQuoteIndex)
      .map((line, index, lines) => {
        if (line.posts !== lines[index - 1]?.posts) rank = index + 1;
        return {...line, rank};
      })
      .filter(line => quoteTokens[line.index].includes(" " + query));
    const lower = value => value ?? -Infinity;
    const compare = {
      average: (a, b) => lower(averageScore(b)) - lower(averageScore(a)),
      peak: (a, b) => lower(b.peakScore) - lower(a.peakScore),
      comments: (a, b) => lower(b.comments) - lower(a.comments),
      recent: (a, b) => b.last.localeCompare(a.last),
      first: (a, b) => (a.first || "9999").localeCompare(b.first || "9999"),
      name: (a, b) => quoteTokens[a.index].localeCompare(quoteTokens[b.index]),
    }[episodeQuoteSort.value];
    if (compare) rows.sort((a, b) => compare(a, b) || a.rank - b.rank);

    const size = Number(episodeQuoteSize.value);
    const pages = Math.ceil(rows.length / size);
    episodeQuotePage = Math.min(episodeQuotePage, Math.max(0, pages - 1));
    const start = episodeQuotePage * size;
    const dateCell = date => date ? `<td><time datetime="${safe(date)}">${safe(formatDay(date))}</time></td>` : "<td>—</td>";
    const integer = value => value === null ? "—" : nf.format(value);
    byId("episode-quotes-title").textContent = `Quotes from ${episode.title}`;
    byId("episode-quotes-summary").textContent = `${episode.episode_id} · ${count(episodeStats.distinct, "matched line")} · ${count(episodeStats.posts, "post")} in the current filters`;
    byId("episode-quotes-body").innerHTML = rows.slice(start, start + size).map(line => {
      const key = "q" + line.index;
      const mean = averageScore(line);
      return `<tr>${numberCell(nf.format(line.rank))}
        <td><button type="button" class="row-link" data-focus="${key}" aria-current="${focus === key}">${safe(quoteTitle(line.index))}</button></td>
        ${numberCell(nf.format(line.posts))}
        ${numberCell(percent(share(line.posts, episodeStats.posts)))}
        ${numberCell(mean === null ? "—" : scoreFormat.format(mean))}
        ${numberCell(integer(line.peakScore))}
        ${numberCell(integer(line.comments))}
        ${dateCell(line.first)}${dateCell(line.last)}</tr>`;
    }).join("");
    const empty = byId("episode-quotes-empty");
    empty.hidden = rows.length > 0;
    empty.textContent = episodeStats.distinct ? "No quotes match this search." : "No matched quotes in the current filters.";
    byId("episode-quotes-range").textContent = rows.length
      ? `${nf.format(start + 1)}–${nf.format(Math.min(start + size, rows.length))} of ${count(rows.length, "quote")}`
      : "0 quotes";
    episodeQuotePageSelect.replaceChildren(...Array.from({length: pages}, (_, index) =>
      option(index, `Page ${nf.format(index + 1)} of ${nf.format(pages)}`)));
    if (!pages) episodeQuotePageSelect.add(option("", "No pages"));
    else episodeQuotePageSelect.value = episodeQuotePage;
    episodeQuotePageSelect.disabled = pages <= 1;
    episodeQuotePrev.disabled = episodeQuotePage === 0;
    episodeQuoteNext.disabled = episodeQuotePage + 1 >= pages;
  }

  function renderTrend() {
    const period = byId("trend-period").value;
    const isShare = byId("trend-measure").value === "share";
    const groups = new Map();
    const groupsByDay = new Map();
    if (selected.months.length) {
      const cursor = new Date(selected.months[0] + "-01T00:00:00Z");
      const end = new Date(selected.months.at(-1) + "-01T00:00:00Z");
      end.setUTCMonth(end.getUTCMonth() + 1);
      for (; cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const day = cursor.toISOString().slice(0, 10);
        let key = day.slice(0, period === "year" ? 4 : 7);
        if (period === "week") {
          const monday = new Date(cursor);
          monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
          key = monday.toISOString().slice(0, 10);
        }
        if (!groups.has(key)) groups.set(key, {key, total: 0, posts: 0});
        const group = groups.get(key);
        group.total += stats.daily.get(day) ?? 0;
        groupsByDay.set(day, group);
      }
    }
    if (focus) {
      const [type, index] = focusParts(focus);
      for (const [day, ei, qi] of activity) {
        if (type === "e" ? ei !== index : qi !== index) continue;
        const group = groupsByDay.get(day);
        if (group) group.posts++;
      }
    } else {
      for (const group of groups.values()) group.posts = group.total;
    }
    chartSeries = [...groups.values()].map(group => ({...group,
      value: isShare ? share(group.posts, group.total) : group.posts,
    }));
    const peak = chartSeries.reduce((a, b) => !a || (b.value ?? -1) > (a.value ?? -1) ? b : a, null);
    byId("trend-insight").textContent = peak?.posts
      ? `Peak ${isShare ? "share" : "activity"} · ${formatPeriod(peak.key)} · ${isShare ? percent(peak.value) : count(peak.posts, "post")}`
      : "No dated posts for this selection.";
    pointSelect.replaceChildren(...chartSeries.map(({key}, index) => option(index, formatPeriod(key))));
    pointSelect.disabled = !chartSeries.length;
    chartPoint = -1;
    selectPoint(peak ? chartSeries.indexOf(peak) : -1);
  }

  function selectPoint(index) {
    if (index === chartPoint && index >= 0) return;
    chartPoint = index;
    const point = chartSeries[index];
    if (point) pointSelect.value = index;
    byId("trend-readout").textContent = point
      ? `${formatPeriod(point.key)} · ${count(point.posts, "post")} · ${point.total ? percent(share(point.posts, point.total)) + " of quote posts in view" : "No quote posts in view"}`
      : "No periods to inspect.";
    drawChart();
  }

  function drawChart() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const colors = {grid: token("--grid"), text: token("--muted"), band: token("--pale"), bar: token("--seq-3"), active: token("--series-1")};
    const left = 46;
    const right = 9;
    const top = 17;
    const bottom = height - 27;
    const inner = Math.max(1, width - left - right);
    const isShare = byId("trend-measure").value === "share";
    const max = Math.max(0, ...chartSeries.map(point => point.value));
    const magnitude = Math.pow(10, Math.floor(Math.log10(max / 4 || 1)));
    const step = Math.max(isShare ? 0.01 : 1, Math.ceil((max / 4) / magnitude) * magnitude);
    const ceiling = Math.max(step, Math.ceil(max / step) * step);
    const y = number => bottom - (bottom - top) * number / ceiling;
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let tick = 0; tick <= Math.round(ceiling / step); tick++) {
      const value = tick * step;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(width - right, y(value));
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.fillText(isShare ? percent(value, step < 1 ? 2 : 0) : nf.format(value), left - 7, y(value));
    }
    const spacing = inner / chartSeries.length;
    const every = Math.max(1, Math.ceil(chartSeries.length / Math.max(1, Math.floor(inner / 70))));
    ctx.textAlign = "center";
    chartSeries.forEach((point, index) => {
      const center = left + (index + .5) * spacing;
      const bar = Math.max(1, Math.min(55, spacing * .72));
      if (chartPoint === index) {
        ctx.fillStyle = colors.band;
        ctx.fillRect(center - spacing / 2, top, spacing, bottom - top);
      }
      if (point.value > 0) {
        ctx.fillStyle = chartPoint === index ? colors.active : colors.bar;
        ctx.fillRect(center - bar / 2, y(point.value), bar, bottom - y(point.value));
      }
      if (index % every === 0) {
        ctx.fillStyle = colors.text;
        const label = point.key.length === 10 ? axisDayFormat.format(new Date(point.key + "T00:00:00Z")) : formatMonth(point.key);
        ctx.fillText(label, Math.max(left + 13, Math.min(center, width - 31)), bottom + 13);
      }
    });
  }

  function renderCharts(all) {
    const C = window.QuoteCharts;
    if (!C) return;
    const mount = (id, render, table) => C.mount(id, render, table);
    const dated = activity.filter(([day]) => day);
    const focusTip = (label, value, extra = "") => `${label}: ${count(value, "post")}${extra}`;

    /* Quote frequency */
    const tiers = [["1", 1, 1], ["2", 2, 2], ["3", 3, 3], ["4", 4, 4], ["5", 5, 5], ["6–10", 6, 10], ["11–20", 11, 20], ["21+", 21, Infinity]];
    const tierCounts = tiers.map(([label, lo, hi]) => ({label, value: all.orderedQuotes.filter(q => q.posts >= lo && q.posts <= hi).length}));
    const oneOffs = tierCounts[0].value;
    mount("chart-repeats", width => C.bars(width, {
      data: tierCounts.map(d => ({...d, tip: `${count(d.value, "line")} posted ${d.label === "1" ? "once" : d.label + " times"} · ${percent(share(d.value, all.orderedQuotes.length))} of lines`})),
      axisLabel: "Posts per line", valueLabels: "all", ariaLabel: "Distinct lines grouped by number of posts",
    }), {headers: ["Posts per line", "Lines", "Share of lines"], caption: "Lines by number of posts",
      rows: tierCounts.map(d => [d.label, nf.format(d.value), percent(share(d.value, all.orderedQuotes.length))])});
    const cumulative = [];
    let running = 0;
    all.orderedQuotes.forEach((q, i) => { running += q.posts; cumulative[i + 1] = running; });
    const total = all.orderedQuotes.length;
    const samples = [...new Set([1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000, 10000, total]
      .filter(n => n >= 1 && n <= total))].sort((a, b) => a - b);
    const shareAt = n => share(cumulative[Math.min(n, total)], all.posts);
    const marks = [10, 100, 1000].filter(n => n <= total);
    mount("chart-pareto", width => C.line(width, {
      data: samples.map(n => ({x: n, y: shareAt(n)})), log: true, yMax: 100, yFormat: v => percent(v, 0),
      xLabel: "Top N lines (log scale)", ariaLabel: "Cumulative share of posts covered by the top N lines",
      callouts: marks.map((n, i) => ({x: n, y: shareAt(n), label: `Top ${nf.format(n)} · ${percent(shareAt(n), 0)}`, dy: -10,
        tip: `The ${nf.format(n)} most posted lines account for ${percent(shareAt(n))} of all quote posts`})),
    }), {headers: ["Top N lines", "Posts covered", "Share of posts"], caption: "Cumulative share of posts by top lines",
      rows: samples.map(n => [nf.format(n), nf.format(cumulative[Math.min(n, total)]), percent(shareAt(n))])});
    const onePercent = Math.max(1, Math.round(total / 100));
    byId("tail-summary").textContent = total
      ? `${percent(share(oneOffs, total))} of the ${nf.format(total)} distinct lines were posted exactly once. The top 1% (${nf.format(onePercent)} lines) account for ${percent(shareAt(onePercent))} of quote posts.`
      : "No matched quote posts yet.";

    /* Seasons */
    const seasonRows = [...seasons].map(([season, row]) => {
      const indexes = [...row.values()];
      const posts = indexes.reduce((sum, index) => sum + all.ep[index].posts, 0);
      const distinct = indexes.reduce((sum, index) => sum + all.ep[index].distinct, 0);
      return {season, posts, distinct, episodes: indexes.length, rate: posts / indexes.length};
    });
    const topSeason = [...seasonRows].sort((a, b) => b.posts - a.posts)[0];
    const topRate = [...seasonRows].sort((a, b) => b.rate - a.rate)[0];
    mount("chart-seasons", width => C.bars(width, {
      data: seasonRows.map(r => ({label: `S${r.season}`, value: r.posts, key: r.season, focus: `s${r.season}`,
        tip: `Season ${r.season}: ${count(r.posts, "post")} · ${count(r.distinct, "distinct line")} · ${count(r.episodes, "episode")}`})),
      emphasis: topSeason?.season, valueLabels: "none", ariaLabel: "Quote posts per season",
    }), {headers: ["Season", "Posts", "Distinct lines", "Episodes"], caption: "Quote posts per season",
      rows: seasonRows.map(r => [`Season ${r.season}`, nf.format(r.posts), nf.format(r.distinct), nf.format(r.episodes)])});
    mount("chart-season-rate", width => C.bars(width, {
      data: seasonRows.map(r => ({label: `S${r.season}`, value: Math.round(r.rate * 10) / 10, key: r.season, focus: `s${r.season}`,
        tip: `Season ${r.season}: ${scoreFormat.format(r.rate)} posts per episode (${count(r.posts, "post")} across ${count(r.episodes, "episode")})`})),
      emphasis: topRate?.season, format: v => scoreFormat.format(v), tickFormat: v => nf.format(v), valueLabels: "none", ariaLabel: "Quote posts per episode by season",
    }), {headers: ["Season", "Posts per episode"], caption: "Quote posts per episode by season",
      rows: seasonRows.map(r => [`Season ${r.season}`, scoreFormat.format(r.rate)])});
    byId("seasons-summary").textContent = topSeason
      ? `Season ${topSeason.season} supplies the most quote posts (${nf.format(topSeason.posts)}, ${percent(share(topSeason.posts, all.posts))} of the archive). Per episode, season ${topRate.season} is the densest at ${scoreFormat.format(topRate.rate)} posts per episode.`
      : "";

    /* Episode age */
    const ages = [];
    const ageBuckets = Array.from({length: 22}, () => 0);
    const years = [...new Set(dated.map(([day]) => day.slice(0, 4)))].sort();
    const era = new Map(years.map(year => [year, new Map()]));
    for (const [day, ei] of dated) {
      const aired = episodes[ei].aired;
      if (aired) {
        const age = (Date.parse(day) - Date.parse(aired)) / (365.25 * 86400000);
        if (age >= 0) {
          ages.push(age);
          ageBuckets[Math.min(21, Math.floor(age))]++;
        }
      }
      const row = era.get(day.slice(0, 4));
      row.set(episodes[ei].season, (row.get(episodes[ei].season) ?? 0) + 1);
    }
    const medianAge = median(ages);
    const fresh = ageBuckets[0];
    const seasonList = [...seasons.keys()];
    mount("chart-age", width => C.bars(width, {
      data: ageBuckets.map((value, age) => ({label: age === 21 ? "21+" : String(age), value, always: age % 3 === 0 || age === 21,
        tip: `${age === 21 ? "21 years or older" : age === 0 ? "Under a year old" : `${age} to ${age + 1} years old`}: ${count(value, "post")}`})),
      axisLabel: "Years since the episode aired", valueLabels: "none", ariaLabel: "Episode age at posting time",
    }), {headers: ["Age in years", "Posts"], caption: "Episode age at posting time",
      rows: ageBuckets.map((value, age) => [age === 21 ? "21+" : String(age), nf.format(value)])});
    mount("chart-era", width => C.heatmap(width, {
      rows: years, cols: seasonList.map(s => `S${s}`), rowLabelWidth: 40,
      cell: (r, c) => era.get(years[r]).get(seasonList[c]) ?? 0,
      tip: (r, c, value) => `${years[r]} posts quoting season ${seasonList[c]}: ${count(value, "post")}`,
      ariaLabel: "Posts by posting year and season quoted",
    }), {headers: ["Year", ...seasonList.map(s => `S${s}`)], caption: "Posts by posting year and season quoted",
      rows: years.map(year => [year, ...seasonList.map(s => nf.format(era.get(year).get(s) ?? 0))])});
    byId("nostalgia-summary").textContent = medianAge === null ? "" :
      `The median quoted episode was ${scoreFormat.format(medianAge)} years old. Only ${percent(share(fresh, ages.length))} of posts with an air date quoted an episode less than a year old.`;

    /* Reddit scores */
    const bands = [["≤ 0", -Infinity, 0], ["1–9", 1, 9], ["10–49", 10, 49], ["50–99", 50, 99], ["100–249", 100, 249], ["250–499", 250, 499], ["500–999", 500, 999], ["1,000+", 1000, Infinity]];
    const scored = activity.filter(row => typeof row[4] === "number");
    const bandCounts = bands.map(([label, lo, hi]) => ({label, value: scored.filter(row => row[4] >= lo && row[4] <= hi).length}));
    const medianScore = median(scored.map(row => row[4]));
    const medianComments = median(activity.map(row => row[5]).filter(v => typeof v === "number"));
    const best = scored.reduce((top, row) => !top || row[4] > top[4] ? row : top, null);
    mount("chart-scores", width => C.bars(width, {
      data: bandCounts.map(d => ({...d, tip: `Score ${d.label}: ${count(d.value, "post")} · ${percent(share(d.value, scored.length))}`})),
      axisLabel: "Reddit score", valueLabels: "all", ariaLabel: "Quote posts by score band",
    }), {headers: ["Score band", "Posts", "Share"], caption: "Quote posts by Reddit score band",
      rows: bandCounts.map(d => [d.label, nf.format(d.value), percent(share(d.value, scored.length))])});
    const repeatTiers = [["Posted once", 1, 1], ["2", 2, 2], ["3–5", 3, 5], ["6–10", 6, 10], ["11+", 11, Infinity]];
    const tierScores = repeatTiers.map(([label, lo, hi]) => {
      const scores = scored.filter(row => { const n = all.lines.get(row[2]).posts; return n >= lo && n <= hi; }).map(row => row[4]);
      return {label, value: median(scores) ?? 0,
        mean: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null, posts: scores.length};
    });
    mount("chart-repeat-score", width => C.bars(width, {
      data: tierScores.map(d => ({...d, tip: d.posts ? `Median score ${nf.format(d.value)} across ${count(d.posts, "post")}` : "No scored posts"})),
      axisLabel: "Posts the line received", valueLabels: "all", color: "var(--series-5)", ariaLabel: "Median score by how often the line was posted",
    }), {headers: ["Posts per line", "Median score", "Average score", "Scored posts"], caption: "Reddit scores by posts per line",
      rows: tierScores.map(d => [d.label, d.posts ? nf.format(d.value) : "—", d.posts ? nf.format(d.mean) : "—", nf.format(d.posts)])});
    const [once, often] = [tierScores[0], tierScores.at(-1)];
    byId("scores-summary").textContent = medianScore === null ? "" :
      `The typical post scores ${nf.format(medianScore)} points${medianComments === null ? "" : ` and draws ${count(medianComments, "comment")}`}.` +
      (once.posts && often.posts ? ` The median is ${nf.format(often.value)} points for lines posted at least 11 times and ${nf.format(once.value)} for lines posted once.` : "");

    const formats = new Map();
    for (const row of activity) {
      const label = post_formats?.[row[8]] ?? "unknown";
      formats.set(label, (formats.get(label) ?? 0) + 1);
    }
    const formatRows = [...formats].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({
      label: label[0].toUpperCase() + label.slice(1), value,
      tip: `${count(value, "post")} · ${percent(share(value, all.posts))} of matched posts`,
    }));
    byId("post-formats").hidden = !post_formats || !formatRows.length;
    if (post_formats && formatRows.length) {
      const [top] = formatRows;
      byId("formats-summary").textContent = `${top.label} leads at ${percent(share(top.value, all.posts))} of matched posts.`;
      mount("chart-formats", width => C.bars(width, {data: formatRows, valueLabels: "all", ariaLabel: "Quote posts by Reddit format"}),
        {headers: ["Format", "Posts", "Share"], caption: "Reddit format of matched quote posts",
          rows: formatRows.map(row => [row.label, nf.format(row.value), percent(share(row.value, all.posts))])});
    }

    return {medianScore, medianAge, best};
  }

  function applyFilters() {
    selected = filterState();
    stats = aggregate(selected);
    page = 0;
    byId("filter-summary").textContent = `${count(stats.posts, "quote post")} · ${count(stats.orderedQuotes.length, "distinct line")} · ${percent(share(stats.touchedCues, stats.subtitleCues))} of indexed dialogue quoted`;
    renderQuickSearch();
    renderRanking();
    renderHeatmap();
    renderFocus();
    renderDetail();
    renderTrend();
  }

  function updateSort() {
    sort.replaceChildren(...sorts[mode].map(([value, label]) => option(value, label)));
    search.placeholder = mode === "quotes" ? "Search lines or episodes" : "Search episodes";
  }

  function selectRanking(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    for (const button of byId("ranking-tabs").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.mode === mode);
    }
    updateSort();
  }

  quickQuery.addEventListener("input", () => {
    randomQuote = null;
    renderQuickSearch();
  });
  byId("quick-search").addEventListener("submit", event => {
    event.preventDefault();
    if (quickResults.hidden) return;
    quickResults.querySelector("button[data-focus]")?.focus({preventScroll: true});
    quickResults.scrollIntoView();
  });
  function rollQuote() {
    const choices = stats.orderedQuotes.filter(({index}) => index !== randomQuote);
    const line = choices[Math.floor(Math.random() * choices.length)] ?? stats.orderedQuotes[0];
    if (!line) return;
    randomQuote = line.index;
    quickQuery.value = "";
    renderQuickSearch();
    quickResults.scrollIntoView({block: "nearest"});
  }
  randomButton.addEventListener("click", rollQuote);
  rerollButton.addEventListener("click", rollQuote);
  quickResults.addEventListener("click", event => {
    const button = event.target.closest("button[data-results]");
    if (!button) return;
    search.value = quickQuery.value;
    selectRanking(button.dataset.results);
    sort.value = "posts";
    page = 0;
    renderRanking();
    search.focus({preventScroll: true});
    byId("explore").scrollIntoView();
  });

  byId("filters").addEventListener("change", event => {
    if (from.value && through.value && from.value > through.value) {
      if (event.target === from) through.value = from.value;
      else from.value = through.value;
    }
    applyFilters();
  });
  byId("filters").addEventListener("reset", () => requestAnimationFrame(applyFilters));
  byId("filters").addEventListener("submit", event => event.preventDefault());
  byId("ranking-tabs").addEventListener("click", event => {
    const tab = event.target.closest("button[data-mode]");
    if (!tab || mode === tab.dataset.mode) return;
    selectRanking(tab.dataset.mode);
    page = 0;
    renderRanking();
  });
  for (const control of [search, sort]) control.addEventListener(control === search ? "input" : "change", () => {
    page = 0;
    renderRanking();
  });
  byId("next").addEventListener("click", () => { page++; renderRanking(); });
  byId("prev").addEventListener("click", () => { page--; renderRanking(); });
  for (const control of [episodeQuoteSearch, episodeQuoteSort, episodeQuoteSize]) {
    control.addEventListener(control === episodeQuoteSearch ? "input" : "change", () => {
      episodeQuotePage = 0;
      renderEpisodeQuotes();
    });
  }
  episodeQuotePageSelect.addEventListener("change", () => {
    episodeQuotePage = Number(episodeQuotePageSelect.value);
    renderEpisodeQuotes();
  });
  episodeQuotePrev.addEventListener("click", () => { episodeQuotePage--; renderEpisodeQuotes(); });
  episodeQuoteNext.addEventListener("click", () => { episodeQuotePage++; renderEpisodeQuotes(); });
  byId("heat-metric").addEventListener("change", renderHeatmap);
  for (const type of ["pointerover", "focusin"]) grid.addEventListener(type, event => {
    const tile = event.target.closest(".heat-tile");
    if (!tile) return;
    byId("heat-detail").textContent = tile.getAttribute("aria-label");
    if (type === "focusin") {
      const previous = grid.querySelector('[tabindex="0"]');
      if (previous) previous.tabIndex = -1;
      tile.tabIndex = 0;
      heatCursor = Number(tile.dataset.index);
    }
  });
  grid.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (!event.target.matches(".heat-tile")) return;
    event.preventDefault();
    const current = episodes[heatCursor];
    const column = ["ArrowLeft", "ArrowRight"].includes(event.key);
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    const options = stats.activeEpisodes.filter(index => column ? episodes[index].season === current.season : episodes[index].episode === current.episode);
    const neighbor = options[options.indexOf(heatCursor) + direction];
    if (neighbor !== undefined) grid.querySelector(`[data-index="${neighbor}"]`)?.focus();
  });
  function focusSeason(season) {
    seasonSelect.value = String(season);
    applyFilters();
    byId("explore").scrollIntoView();
    seasonSelect.focus({preventScroll: true});
  }
  document.addEventListener("chart-focus", event => {
    const key = event.detail;
    if (key[0] === "s") focusSeason(Number(key.slice(1)));
    else focusItem(key);
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-focus]");
    if (!button) return;
    focusItem(button.dataset.focus);
  });
  function focusItem(key) {
    focus = key;
    if (byId("trend-period").value === "year") byId("trend-period").value = "month";
    const [type, index] = focusParts(focus);
    const episode = episodes[type === "e" ? index : quotes[index][0]];
    if (seasonSelect.value && Number(seasonSelect.value) !== episode.season) {
      seasonSelect.value = String(episode.season);
      applyFilters();
    } else {
      renderFocus();
      renderDetail();
      renderTrend();
    }
    focusSelect.focus({preventScroll: true});
    byId("timeline").scrollIntoView();
  }
  focusSelect.addEventListener("change", () => {
    focus = focusSelect.value;
    renderFocus();
    renderDetail();
    renderTrend();
  });
  for (const id of ["trend-period", "trend-measure"]) byId(id).addEventListener("change", renderTrend);
  pointSelect.addEventListener("change", () => selectPoint(Number(pointSelect.value)));
  canvas.addEventListener("pointermove", event => {
    if (!chartSeries.length) return;
    const fraction = (event.offsetX - 46) / (canvas.clientWidth - 55);
    selectPoint(Math.min(chartSeries.length - 1, Math.max(0, Math.floor(fraction * chartSeries.length))));
  });
  new ResizeObserver(drawChart).observe(canvas);
  renderOverview();
  updateSort();
  applyFilters();
}
