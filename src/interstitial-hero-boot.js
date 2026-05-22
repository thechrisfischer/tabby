/**
 * Synchronous hero backdrop before the module loads (CSP: MV3 forbids inline scripts).
 * Keep PERSONAS in sync with src/heroes.json and the constants in src/interstitial.js.
 */
(function () {
  var PERSONAS = {
    landscape: {
      files: [
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
      ],
      positions: [
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
      ],
    },
    cats: {
      files: [
        "cats-01.jpg",
        "cats-02.jpg",
        "cats-03.jpg",
        "cats-04.jpg",
        "cats-05.jpg",
        "cats-06.jpg",
        "cats-07.jpg",
        "cats-08.jpg",
      ],
      positions: [
        "center 45%",
        "center 40%",
        "center 55%",
        "center 50%",
        "center 35%",
        "center 60%",
        "center 50%",
        "center 45%",
      ],
    },
    fractals: {
      files: [
        "fractals-01.jpg",
        "fractals-02.jpg",
        "fractals-03.jpg",
        "fractals-04.jpg",
        "fractals-05.jpg",
        "fractals-06.jpg",
        "fractals-07.jpg",
        "fractals-08.jpg",
      ],
      positions: [
        "center 50%",
        "30% 40%",
        "70% 35%",
        "center 30%",
        "center 60%",
        "40% 50%",
        "60% 45%",
        "center 50%",
      ],
    },
  };
  var DEFAULT_PERSONA = "landscape";
  var PERSONA_STORAGE_KEY = "tabby-hero-persona";

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
  function readPersona() {
    try {
      var stored = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (stored && PERSONAS[stored]) return stored;
    } catch (_e) {
      /* ignore */
    }
    return DEFAULT_PERSONA;
  }
  function pickHero(seed, conf) {
    var s = seed >>> 0;
    return {
      file: conf.files[s % conf.files.length],
      position: conf.positions[((s * 5011 + 17) >>> 0) % conf.positions.length],
    };
  }
  var u = new URL(location.href);
  var seed = heroSeedFromInvocation(u.searchParams.get("k"), u.searchParams.get("c"));
  var persona = readPersona();
  var p = pickHero(seed, PERSONAS[persona]);
  var img = document.getElementById("backdrop-img");
  if (!img) return;
  img.src = chrome.runtime.getURL("src/assets/" + p.file);
  img.style.objectPosition = p.position;
  img.dataset.tabbyHeroFile = p.file;
  img.dataset.tabbyHeroPos = p.position;
  img.dataset.tabbyHeroPersona = persona;
})();
