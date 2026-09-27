(() => {
  "use strict";

  const API = {
    channels: "https://iptv-org.github.io/api/channels.json",
    streams: "https://iptv-org.github.io/api/streams.json",
    countries: "https://iptv-org.github.io/api/countries.json",
    categories: "https://iptv-org.github.io/api/categories.json",
    blocklist: "https://iptv-org.github.io/api/blocklist.json",
  };

  const PAGE_SIZE = 60;

  // ---------- DOM ----------
  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("emptyState");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  const searchInput = document.getElementById("searchInput");
  const resultCount = document.getElementById("resultCount");
  const countryFilter = document.getElementById("countryFilter");
  const categoryFilter = document.getElementById("categoryFilter");
  const onlyPlayable = document.getElementById("onlyPlayable");
  const hideNsfw = document.getElementById("hideNsfw");
  const sortOrder = document.getElementById("sortOrder");
  const resetFilters = document.getElementById("resetFilters");
  const statusWrap = document.getElementById("loadStatus");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  const playerModal = document.getElementById("playerModal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const closePlayer = document.getElementById("closePlayer");
  const video = document.getElementById("video");
  const videoOverlay = document.getElementById("videoOverlay");
  const videoOverlayText = document.getElementById("videoOverlayText");
  const playerTitle = document.getElementById("playerTitle");
  const playerMeta = document.getElementById("playerMeta");
  const playerFlag = document.getElementById("playerFlag");
  const streamPicker = document.getElementById("streamPicker");
  const visitSite = document.getElementById("visitSite");

  // ---------- State ----------
  let channels = [];
  let streamsByChannel = new Map();
  let countryByCode = new Map();
  let categoryById = new Map();
  let blockedIds = new Set();

  let filtered = [];
  let visibleCount = PAGE_SIZE;
  let hls = null;
  let searchDebounce = null;

  // ---------- Fetch helpers ----------
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  function setStatus(mode, text) {
    statusWrap.classList.remove("ready", "error");
    if (mode) statusWrap.classList.add(mode);
    statusText.textContent = text;
  }

  // ---------- Init ----------
  async function init() {
    setStatus(null, "tuning in…");
    try {
      const [channelsData, streamsData, countriesData, categoriesData, blocklistData] =
        await Promise.all([
          getJSON(API.channels),
          getJSON(API.streams),
          getJSON(API.countries),
          getJSON(API.categories),
          getJSON(API.blocklist).catch(() => []), // non-critical
        ]);

      countriesData.forEach((c) => countryByCode.set(c.code, c));
      categoriesData.forEach((c) => categoryById.set(c.id, c));
      blocklistData.forEach((b) => blockedIds.add(b.channel));

      streamsData.forEach((s) => {
        if (!s.channel) return;
        if (!streamsByChannel.has(s.channel)) streamsByChannel.set(s.channel, []);
        streamsByChannel.get(s.channel).push(s);
      });

      channels = channelsData.filter((c) => !c.closed && !blockedIds.has(c.id));

      populateFilterOptions(countriesData, categoriesData);
      setStatus("ready", `${channels.length.toLocaleString()} channels loaded`);
      applyFilters();
    } catch (err) {
      console.error(err);
      setStatus("error", "couldn't load channel data — check your connection");
      emptyState.classList.remove("hidden");
      emptyState.querySelector("p").textContent =
        "Couldn't reach the iptv-org API. Check your internet connection and reload.";
    }
  }

  function populateFilterOptions(countriesData, categoriesData) {
    const countryCounts = new Map();
    channels.forEach((c) => countryCounts.set(c.country, (countryCounts.get(c.country) || 0) + 1));

    const sortedCountries = countriesData
      .filter((c) => countryCounts.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));

    sortedCountries.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.flag ? c.flag + " " : ""}${c.name} (${countryCounts.get(c.code)})`;
      countryFilter.appendChild(opt);
    });

    const categoryCounts = new Map();
    channels.forEach((c) =>
      (c.categories || []).forEach((cat) => categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1))
    );

    const sortedCategories = categoriesData
      .filter((c) => categoryCounts.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    sortedCategories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${categoryCounts.get(c.id)})`;
      categoryFilter.appendChild(opt);
    });
  }

  // ---------- Filtering ----------
  function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    const country = countryFilter.value;
    const category = categoryFilter.value;
    const needStream = onlyPlayable.checked;
    const noNsfw = hideNsfw.checked;

    filtered = channels.filter((c) => {
      if (noNsfw && c.is_nsfw) return false;
      if (country && c.country !== country) return false;
      if (category && !(c.categories || []).includes(category)) return false;
      if (needStream && !streamsByChannel.has(c.id)) return false;
      if (q) {
        const hay = (c.name + " " + (c.alt_names || []).join(" ") + " " + (c.network || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortOrder.value === "country") {
      filtered.sort((a, b) => {
        const ca = countryByCode.get(a.country)?.name || a.country;
        const cb = countryByCode.get(b.country)?.name || b.country;
        return ca.localeCompare(cb) || a.name.localeCompare(b.name);
      });
    } else {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    visibleCount = PAGE_SIZE;
    render();
  }

  // ---------- Rendering ----------
  function render() {
    grid.innerHTML = "";
    resultCount.textContent = filtered.length.toLocaleString();

    if (filtered.length === 0) {
      emptyState.classList.remove("hidden");
      loadMoreBtn.classList.add("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    const slice = filtered.slice(0, visibleCount);
    const frag = document.createDocumentFragment();
    slice.forEach((c) => frag.appendChild(buildCard(c)));
    grid.appendChild(frag);

    loadMoreBtn.classList.toggle("hidden", visibleCount >= filtered.length);
  }

  function buildCard(c) {
    const country = countryByCode.get(c.country);
    const streams = streamsByChannel.get(c.id);

    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Play ${c.name}`);

    const top = document.createElement("div");
    top.className = "card-top";
    const flag = document.createElement("span");
    flag.className = "card-flag";
    flag.textContent = country?.flag || "📺";
    const num = document.createElement("span");
    num.className = "card-num";
    num.textContent = streams ? `${streams.length} stream${streams.length > 1 ? "s" : ""}` : "no stream";
    top.append(flag, num);

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = c.name;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    if (country) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = country.name;
      meta.appendChild(t);
    }
    (c.categories || []).slice(0, 2).forEach((catId) => {
      const cat = categoryById.get(catId);
      if (!cat) return;
      const t = document.createElement("span");
      t.className = "tag category";
      t.textContent = cat.name;
      meta.appendChild(t);
    });

    card.append(top, name, meta);
    card.addEventListener("click", () => openPlayer(c));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPlayer(c);
      }
    });

    return card;
  }

  // ---------- Player ----------
  function openPlayer(channel) {
    const country = countryByCode.get(channel.country);
    playerTitle.textContent = channel.name;
    playerMeta.textContent = [country?.name, (channel.categories || []).map((id) => categoryById.get(id)?.name).filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · ") || "—";
    playerFlag.textContent = country?.flag || "📺";

    if (channel.website) {
      visitSite.href = channel.website;
      visitSite.classList.remove("hidden");
    } else {
      visitSite.classList.add("hidden");
    }

    const streams = streamsByChannel.get(channel.id) || [];
    streamPicker.innerHTML = "";

    if (streams.length === 0) {
      showOverlay("No stream link is available for this channel yet.");
    } else {
      streams.forEach((s, i) => {
        const btn = document.createElement("button");
        btn.className = "stream-btn" + (i === 0 ? " active" : "");
        btn.textContent = s.quality || s.title || `Stream ${i + 1}`;
        btn.addEventListener("click", () => {
          streamPicker.querySelectorAll(".stream-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          playStream(s);
        });
        streamPicker.appendChild(btn);
      });
      playStream(streams[0]);
    }

    playerModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function showOverlay(text) {
    videoOverlayText.textContent = text;
    videoOverlay.classList.remove("hidden");
  }
  function hideOverlay() {
    videoOverlay.classList.add("hidden");
  }

  function playStream(streamObj) {
    destroyHls();
    showOverlay("Loading stream…");
    const url = streamObj.url;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari)
      video.src = url;
      video.addEventListener("loadedmetadata", () => { hideOverlay(); video.play().catch(() => {}); }, { once: true });
      video.addEventListener("error", () => showOverlay("This stream couldn't be played (it may be offline or geo-blocked)."), { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hideOverlay();
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          showOverlay("This stream couldn't be played (it may be offline or geo-blocked).");
        }
      });
    } else {
      video.src = url;
      video.addEventListener("loadedmetadata", () => { hideOverlay(); video.play().catch(() => {}); }, { once: true });
      video.addEventListener("error", () => showOverlay("Your browser can't play this stream format."), { once: true });
    }
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.removeAttribute("src");
    video.load();
  }

  function closePlayerModal() {
    destroyHls();
    playerModal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  // ---------- Events ----------
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 200);
  });
  countryFilter.addEventListener("change", applyFilters);
  categoryFilter.addEventListener("change", applyFilters);
  onlyPlayable.addEventListener("change", applyFilters);
  hideNsfw.addEventListener("change", applyFilters);
  sortOrder.addEventListener("change", applyFilters);

  resetFilters.addEventListener("click", () => {
    searchInput.value = "";
    countryFilter.value = "";
    categoryFilter.value = "";
    onlyPlayable.checked = true;
    hideNsfw.checked = true;
    sortOrder.value = "name";
    applyFilters();
  });

  loadMoreBtn.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    render();
  });

  closePlayer.addEventListener("click", closePlayerModal);
  modalBackdrop.addEventListener("click", closePlayerModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !playerModal.classList.contains("hidden")) closePlayerModal();
  });

  init();
})();
