// Aplica o tema salvo antes da página aparecer (evita piscar).
(function () {
  try {
    var ok = ["claro", "noite", "rosa", "amarelo"];
    var legacy = { escuro: "noite", joaninha: "noite" };
    var pref = JSON.parse(localStorage.getItem("tl.theme") || '"noite"');
    pref = legacy[pref] || pref;
    var t = pref;
    if (ok.indexOf(pref) < 0) {
      t = pref === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "noite";
    }
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", { claro: "#FBF6F5", rosa: "#FFF0F6", amarelo: "#FFF8D6" }[t] || "#0F0A13");
    var lang = JSON.parse(localStorage.getItem("tl.lang") || "null") || ((navigator.language || "pt").slice(0, 2) === "en" ? "en" : "pt");
    document.documentElement.setAttribute("lang", lang === "en" ? "en" : "pt-BR");
  } catch (e) {}
})();
