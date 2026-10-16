(() => {
  "use strict";

  const STATUTS = [
    { code: "nouveau", libelle: "Nouveau" },
    { code: "legitime", libelle: "Légitime" },
    { code: "non_legitime", libelle: "Non légitime" },
  ];
  const libelleStatut = Object.fromEntries(STATUTS.map(s => [s.code, s.libelle]));

  // --- Accès aux données -------------------------------------------------
  // En production (IIS) : API du serveur applicatif. Chemin relatif pour fonctionner aussi
  // dans une sous-application IIS (ex. https://serveur/suivimailles/).
  const apiStore = {
    demo: false,
    async lister() {
      const r = await fetch("api/mailles", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Chargement impossible (HTTP ${r.status})`);
      return r.json();
    },
    async changerStatut(id, statut) {
      const r = await fetch(`api/mailles/${encodeURIComponent(id)}/statut`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut }),
      });
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
  };

  // En démonstration (artefact de test) : données embarquées, modifications gardées dans ce navigateur.
  const CLE = "suivimailles-demo-v1";
  const demoStore = {
    demo: true,
    _donnees: null,
    async lister() {
      let sauvees = null;
      try { sauvees = JSON.parse(localStorage.getItem(CLE) || "null"); } catch { /* stockage indisponible */ }
      const base = structuredClone(window.SUIVI_DEMO_DATA || []);
      if (sauvees) for (const m of base) if (sauvees[m.id]) m.statut = sauvees[m.id];
      this._donnees = base;
      return structuredClone(base);
    },
    async changerStatut(id, statut) {
      const m = this._donnees.find(x => x.id === id);
      m.statut = statut;
      try {
        const sauvees = JSON.parse(localStorage.getItem(CLE) || "{}");
        sauvees[id] = statut;
        localStorage.setItem(CLE, JSON.stringify(sauvees));
      } catch { /* la modification reste valable jusqu'au rechargement */ }
      return structuredClone(m);
    },
    reinitialiser() {
      try { localStorage.removeItem(CLE); } catch { /* rien à faire */ }
    },
  };

  const store = window.SUIVI_DEMO_DATA ? demoStore : apiStore;

  // --- État ---------------------------------------------------------------
  const etat = { mailles: [], filtres: { societe: "", siren: "", maille: "", statut: "" } };

  const $ = sel => document.querySelector(sel);
  const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const sansEspaces = s => norm(s).replace(/\s+/g, "");
  const formatSiren = s => String(s).replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function surligner(texte, filtre, ignorerEspaces = false) {
    const t = String(texte);
    const f = ignorerEspaces ? sansEspaces(filtre) : norm(filtre);
    if (!f) return esc(t);
    // Correspondance insensible aux accents : on cherche sur la version normalisée, caractère par caractère.
    const map = [];
    let n = "";
    for (let i = 0; i < t.length; i++) {
      const c = norm(t[i]);
      if (ignorerEspaces && /\s/.test(t[i])) continue;
      for (const ch of c) { n += ch; map.push(i); }
    }
    const k = n.indexOf(f);
    if (k < 0) return esc(t);
    const debut = map[k], fin = map[k + f.length - 1] + 1;
    return esc(t.slice(0, debut)) + "<mark>" + esc(t.slice(debut, fin)) + "</mark>" + esc(t.slice(fin));
  }

  const correspond = (m, f) =>
    norm(m.societe).includes(norm(f.societe)) &&
    sansEspaces(m.siren).includes(sansEspaces(f.siren)) &&
    norm(m.maille).includes(norm(f.maille));

  // --- Rendu ----------------------------------------------------------------
  function rendre() {
    const f = etat.filtres;
    // La synthèse suit les filtres de colonnes (société, SIREN, maille) mais pas le filtre de statut,
    // pour toujours voir la répartition complète du périmètre filtré.
    const perimetre = etat.mailles.filter(m => correspond(m, f));
    const visibles = f.statut ? perimetre.filter(m => m.statut === f.statut) : perimetre;

    const total = perimetre.length;
    $("#total").textContent = `${total} maille${total > 1 ? "s" : ""}${total !== etat.mailles.length ? ` sur ${etat.mailles.length}` : ""}`;
    for (const s of STATUTS) {
      const nb = perimetre.filter(m => m.statut === s.code).length;
      const btn = $(`.compteur.${s.code}`);
      btn.querySelector(".nb").innerHTML = `${nb}<span class="pct">${total ? Math.round(nb * 100 / total) : 0} %</span>`;
      btn.setAttribute("aria-pressed", String(f.statut === s.code));
      $(`.barre .${s.code}`).style.flexGrow = nb;
    }

    $("#affiches").textContent = `${visibles.length} ligne${visibles.length > 1 ? "s" : ""} affichée${visibles.length > 1 ? "s" : ""}`;
    $("#effacer").disabled = !Object.values(f).some(Boolean);

    const tbody = $("#lignes");
    if (!visibles.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="vide">${etat.mailles.length ? "Aucune maille ne correspond aux filtres." : "Aucune maille à afficher."}</td></tr>`;
      return;
    }
    tbody.innerHTML = visibles.map(m => `
      <tr data-id="${esc(m.id)}">
        <td class="societe">${surligner(m.societe, f.societe)}</td>
        <td class="siren">${surligner(formatSiren(m.siren), f.siren, true)}</td>
        <td class="maille">${surligner(m.maille, f.maille)}</td>
        <td>
          <select class="statut ${esc(m.statut)}" aria-label="Statut de ${esc(m.maille)} – ${esc(m.societe)}">
            ${STATUTS.map(s => `<option value="${s.code}"${s.code === m.statut ? " selected" : ""}>${s.libelle}</option>`).join("")}
          </select>
        </td>
      </tr>`).join("");
  }

  function toast(message) {
    const t = $("#toast");
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // --- Événements -----------------------------------------------------------
  for (const champ of ["societe", "siren", "maille"]) {
    $(`#f-${champ}`).addEventListener("input", e => { etat.filtres[champ] = e.target.value; rendre(); });
  }
  $("#f-statut").addEventListener("change", e => { etat.filtres.statut = e.target.value; rendre(); });

  $(".compteurs").addEventListener("click", e => {
    const btn = e.target.closest(".compteur");
    if (!btn) return;
    const code = btn.dataset.statut;
    etat.filtres.statut = etat.filtres.statut === code ? "" : code;
    $("#f-statut").value = etat.filtres.statut;
    rendre();
  });

  $("#effacer").addEventListener("click", () => {
    etat.filtres = { societe: "", siren: "", maille: "", statut: "" };
    for (const id of ["f-societe", "f-siren", "f-maille", "f-statut"]) $(`#${id}`).value = "";
    rendre();
  });

  $("#lignes").addEventListener("change", async e => {
    const sel = e.target.closest("select.statut");
    if (!sel) return;
    const id = sel.closest("tr").dataset.id;
    const maille = etat.mailles.find(m => m.id === id);
    const ancien = maille.statut;
    const nouveau = sel.value;

    // Mise à jour immédiate, annulée si le serveur refuse.
    maille.statut = nouveau;
    sel.className = `statut ${nouveau}`;
    sel.setAttribute("aria-busy", "true");
    try {
      const maj = await store.changerStatut(id, nouveau);
      Object.assign(maille, maj);
      toast(`${maille.maille} (${maille.societe}) : ${libelleStatut[nouveau]}`);
    } catch (err) {
      maille.statut = ancien;
      toast(`${err.message}. Le statut reste « ${libelleStatut[ancien]} ».`);
    }
    rendre();
  });

  if (store.demo) {
    $("#demo").hidden = false;
    $("#reinit").addEventListener("click", async () => {
      demoStore.reinitialiser();
      await charger();
      toast("Données de démonstration réinitialisées");
    });
  }

  // --- Démarrage -------------------------------------------------------------
  async function charger() {
    try {
      etat.mailles = await store.lister();
    } catch (err) {
      $("#lignes").innerHTML = `<tr><td colspan="4" class="vide">${esc(err.message)}. Vérifiez que le site IIS est démarré puis rechargez la page.</td></tr>`;
      return;
    }
    etat.mailles.sort((a, b) => a.societe.localeCompare(b.societe, "fr") || a.maille.localeCompare(b.maille, "fr"));
    rendre();
  }
  charger();
})();
