/**
 * Synchronous hero backdrop before the module loads (CSP: MV3 forbids inline scripts).
 * Keep FILES/POSITIONS in sync with src/heroes.json.
 */
(function () {
  var FILES = [
    "bg-01.jpg",
    "bg-02.jpg",
    "bg-03.jpg",
    "bg-04.jpg",
    "bg-05.jpg",
    "bg-06.jpg",
    "bg-07.jpg",
    "bg-08.jpg",
    "bg-09.jpg",
    "bg-10.jpg",
  ];
  var POSITIONS = [
    "center 35%",
    "center 28%",
    "62% 38%",
    "38% 48%",
    "center 42%",
    "72% 32%",
    "28% 36%",
    "center 22%",
    "55% 40%",
    "48% 55%",
  ];
  function fnv1a32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  var HERO_SEED_STORAGE_KEY = "tabby-hero-seed-fallback";
  function heroSeedFromInvocation(k, c) {
    var param = (k || c || "").trim();
    if (param) return fnv1a32(param);
    try {
      var stored = sessionStorage.getItem(HERO_SEED_STORAGE_KEY);
      if (!stored) {
        var buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        stored = String(buf[0] >>> 0);
        sessionStorage.setItem(HERO_SEED_STORAGE_KEY, stored);
      }
      return Number(stored) >>> 0;
    } catch (_e) {
      return 104729;
    }
  }
  function pickHero(seed) {
    var s = seed >>> 0;
    return {
      file: FILES[s % FILES.length],
      position: POSITIONS[((s * 5011 + 17) >>> 0) % POSITIONS.length],
    };
  }
  var u = new URL(location.href);
  var seed = heroSeedFromInvocation(u.searchParams.get("k"), u.searchParams.get("c"));
  var p = pickHero(seed);
  var img = document.getElementById("backdrop-img");
  if (!img) return;
  img.src = chrome.runtime.getURL("src/assets/" + p.file);
  img.style.objectPosition = p.position;
  img.dataset.tabbyHeroFile = p.file;
  img.dataset.tabbyHeroPos = p.position;
})();
