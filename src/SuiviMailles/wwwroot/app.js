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
    async supprimer(id) {
      const r = await fetch(`api/mailles/${encodeURIComponent(id)}`, { method: "DELETE" });
      // 404 : déjà supprimée par quelqu'un d'autre, le résultat attendu est atteint.
      if (!r.ok && r.status !== 404) throw new Error(`Suppression refusée par le serveur (HTTP ${r.status})`);
    },
    async importer(lignes) {
      const r = await fetch("api/mailles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes }),
      });
      if (!r.ok) throw new Error(`Import refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
  };

  // En démonstration (artefact de test) : données embarquées, modifications gardées dans ce navigateur.
  const CLE = "suivimailles-demo-v3";
  const demoStore = {
    demo: true,
    _donnees: [],
    _sauver() {
      try { localStorage.setItem(CLE, JSON.stringify(this._donnees)); } catch { /* valable jusqu'au rechargement */ }
    },
    async lister() {
      let sauvees = null;
      try { sauvees = JSON.parse(localStorage.getItem(CLE) || "null"); } catch { /* stockage indisponible */ }
      this._donnees = Array.isArray(sauvees) ? sauvees : structuredClone(window.SUIVI_DEMO_DATA || []);
      return structuredClone(this._donnees);
    },
    async changerStatut(id, statut) {
      const m = this._donnees.find(x => x.id === id);
      Object.assign(m, { statut, modifieLe: new Date().toISOString() });
      this._sauver();
      return structuredClone(m);
    },
    async supprimer(id) {
      this._donnees = this._donnees.filter(m => m.id !== id);
      this._sauver();
    },
    // Même règles que MailleStore.ImporterAsync côté serveur.
    async importer(lignes) {
      const cle = (siren, maille) => `${siren}|${maille.trim().toLowerCase()}`;
      const connues = new Set(this._donnees.map(m => cle(m.siren, m.maille)));
      let prochainId = Math.max(0, ...this._donnees.map(m => parseInt(m.id, 10) || 0)) + 1;
      const ajoutees = [], rejets = [];
      let dejaPresentes = 0;
      for (const l of lignes) {
        const siren = String(l.siren).replace(/\s/g, "");
        const maille = String(l.maille).trim();
        if (!/^[0-9]{9}$/.test(siren)) { rejets.push({ numero: l.numero, raison: `SIREN invalide « ${l.siren} »` }); continue; }
        if (!maille) { rejets.push({ numero: l.numero, raison: "Maille vide" }); continue; }
        if (connues.has(cle(siren, maille))) { dejaPresentes++; continue; }
        connues.add(cle(siren, maille));
        const m = {
          id: String(prochainId++).padStart(4, "0"),
          societe: this._donnees.find(x => x.siren === siren && x.societe)?.societe ?? "",
          siren, maille, statut: "nouveau", modifieLe: new Date().toISOString(),
        };
        this._donnees.push(m);
        ajoutees.push(structuredClone(m));
      }
      if (ajoutees.length) this._sauver();
      return { ajoutees, dejaPresentes, rejets };
    },
    reinitialiser() {
      try { localStorage.removeItem(CLE); } catch { /* rien à faire */ }
    },
  };

  const store = window.SUIVI_DEMO_DATA ? demoStore : apiStore;

  // --- État ---------------------------------------------------------------
  const etat = { mailles: [], filtres: { societe: "", siren: "", maille: "", statut: "" } };

  const $ = sel => document.querySelector(sel);
  // Sociétés non renseignées (mailles importées) en fin de liste.
  const tri = (a, b) => (!a.societe - !b.societe) || a.societe.localeCompare(b.societe, "fr") || a.maille.localeCompare(b.maille, "fr");
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
      tbody.innerHTML = `<tr><td colspan="5" class="vide">${etat.mailles.length ? "Aucune maille ne correspond aux filtres." : "Aucune maille à afficher."}</td></tr>`;
      return;
    }
    tbody.innerHTML = visibles.map(m => `
      <tr data-id="${esc(m.id)}">
        <td class="societe">${m.societe ? surligner(m.societe, f.societe) : '<span class="inconnue">Non renseignée</span>'}</td>
        <td class="siren">${surligner(formatSiren(m.siren), f.siren, true)}</td>
        <td class="maille">${surligner(m.maille, f.maille)}</td>
        <td>
          <select class="statut ${esc(m.statut)}" aria-label="Statut de ${esc(m.maille)} – ${esc(m.societe)}">
            ${STATUTS.map(s => `<option value="${s.code}"${s.code === m.statut ? " selected" : ""}>${s.libelle}</option>`).join("")}
          </select>
        </td>
        <td class="col-actions">
          <button type="button" class="supprimer" title="Supprimer cette maille" aria-label="Supprimer ${esc(m.maille)}">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 1.5h4a.5.5 0 0 1 .5.5v1H14v1.5h-1l-.7 9.1a1.5 1.5 0 0 1-1.5 1.4H5.2a1.5 1.5 0 0 1-1.5-1.4L3 4.5H2V3h3.5V2a.5.5 0 0 1 .5-.5Zm-1.5 3 .7 9h5.6l.7-9h-7Zm2 1.5h1v6h-1v-6Zm2 0h1v6h-1v-6Z"/></svg>
          </button>
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
      toast(`${maille.maille}${maille.societe ? ` (${maille.societe})` : ""} : ${libelleStatut[nouveau]}`);
    } catch (err) {
      maille.statut = ancien;
      toast(`${err.message}. Le statut reste « ${libelleStatut[ancien]} ».`);
    }
    rendre();
  });

  // --- Suppression avec confirmation ---------------------------------------------
  let aSupprimer = null, focusAvant = null;

  function ouvrirConfirmation(maille) {
    aSupprimer = maille;
    focusAvant = document.activeElement;
    $("#conf-detail").innerHTML = `
      <dt>Maille</dt><dd class="maille">${esc(maille.maille)}</dd>
      <dt>SIREN</dt><dd class="siren">${esc(formatSiren(maille.siren))}</dd>
      <dt>Société</dt><dd>${maille.societe ? esc(maille.societe) : '<span class="inconnue">Non renseignée</span>'}</dd>
      <dt>Statut</dt><dd><span class="pastille-statut ${esc(maille.statut)}">${libelleStatut[maille.statut]}</span></dd>`;
    $("#confirmation").hidden = false;
    $("#conf-annuler").focus();
  }

  function fermerConfirmation() {
    $("#confirmation").hidden = true;
    aSupprimer = null;
    focusAvant?.focus?.();
  }

  $("#lignes").addEventListener("click", e => {
    const btn = e.target.closest("button.supprimer");
    if (!btn) return;
    ouvrirConfirmation(etat.mailles.find(m => m.id === btn.closest("tr").dataset.id));
  });
  $("#conf-annuler").addEventListener("click", fermerConfirmation);
  $("#confirmation").addEventListener("click", e => { if (e.target.id === "confirmation") fermerConfirmation(); });
  document.addEventListener("keydown", e => {
    if ($("#confirmation").hidden) return;
    if (e.key === "Escape") fermerConfirmation();
    if (e.key === "Tab") {
      // Garde le focus dans la fenêtre de confirmation.
      e.preventDefault();
      (document.activeElement === $("#conf-annuler") ? $("#conf-supprimer") : $("#conf-annuler")).focus();
    }
  });
  $("#conf-supprimer").addEventListener("click", async () => {
    const maille = aSupprimer;
    if (!maille) return;
    const btn = $("#conf-supprimer");
    btn.disabled = true;
    try {
      await store.supprimer(maille.id);
      etat.mailles = etat.mailles.filter(m => m.id !== maille.id);
      fermerConfirmation();
      rendre();
      rendreExport();
      toast(`Maille ${maille.maille} supprimée`);
    } catch (err) {
      toast(`${err.message}. La maille n'a pas été supprimée.`);
    } finally {
      btn.disabled = false;
    }
  });

  if (store.demo) {
    $("#demo").hidden = false;
    $("#reinit").addEventListener("click", async () => {
      demoStore.reinitialiser();
      await charger();
      toast("Données de démonstration réinitialisées");
    });
  }

  // --- Onglets ---------------------------------------------------------------
  function afficherOnglet(nom) {
    for (const b of document.querySelectorAll(".onglet")) b.setAttribute("aria-selected", String(b.dataset.onglet === nom));
    for (const p of document.querySelectorAll("[role=tabpanel]")) p.hidden = p.id !== `panneau-${nom}`;
    if (nom === "import") rendreExport();
  }
  document.querySelector(".onglets").addEventListener("click", e => {
    const b = e.target.closest(".onglet");
    if (!b) return;
    afficherOnglet(b.dataset.onglet);
    try { history.replaceState(null, "", b.dataset.onglet === "import" ? "#import" : "#mailles"); } catch { /* sans importance */ }
  });

  // --- Export des SIREN ----------------------------------------------------------
  const sirensDistincts = () => [...new Set(etat.mailles.map(m => m.siren))].sort();

  function rendreExport() {
    const n = sirensDistincts().length;
    $("#nb-siren").textContent = `${n} SIREN distinct${n > 1 ? "s" : ""}, un par ligne, sans en-tête.`;
  }

  $("#exporter").addEventListener("click", async () => {
    if (!store.demo) {
      // Le serveur renvoie le fichier en pièce jointe (siren.csv).
      window.location.href = "api/siren.csv";
      return;
    }
    const contenu = sirensDistincts().map(s => s + "\r\n").join("");
    const downloads = await window.claude?.use?.("downloads");
    if (!downloads) {
      $("#apercu-export").hidden = false;
      $("#apercu-export textarea").value = contenu;
      toast("Téléchargement indisponible ici : le contenu de siren.csv est affiché ci-dessous.");
      return;
    }
    try {
      await downloads.save({ filename: "siren.csv", data: contenu });
      toast("siren.csv enregistré");
    } catch (err) {
      if (err?.code !== "declined") toast("Le fichier n'a pas pu être enregistré.");
    }
  });

  // --- Import des adresses de facturation ----------------------------------------
  // Modèle : SIREN, (non utilisé), (non utilisé), Adresse de facturation = maille, (non utilisé)
  const COL_SIREN = 0, COL_MAILLE = 3;
  let lignesLues = null;

  function decoder(buffer) {
    // Fichier UTF-8 en priorité ; sinon encodage Windows (fichier enregistré depuis Excel).
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, ""); }
    catch { return new TextDecoder("windows-1252").decode(buffer); }
  }

  function lireCsv(texte) {
    const premiere = texte.split(/\r?\n/, 1)[0];
    const sep = premiere.split(";").length > premiere.split(",").length ? ";" : ",";
    const lignes = [];
    let champ = "", ligne = [], guillemets = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (guillemets) {
        if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
        else if (c === '"') guillemets = false;
        else champ += c;
      } else if (c === '"') guillemets = true;
      else if (c === sep) { ligne.push(champ); champ = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texte[i + 1] === "\n") i++;
        ligne.push(champ); lignes.push(ligne); ligne = []; champ = "";
      } else champ += c;
    }
    if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
    return lignes;
  }

  function extraireLignes(texte) {
    const brutes = lireCsv(texte);
    const resultat = [];
    brutes.forEach((cols, i) => {
      if (cols.every(c => !c.trim())) return;                       // ligne vide
      if (i === 0 && !/[0-9]/.test(cols[COL_SIREN] ?? "")) return;   // en-tête
      let siren = (cols[COL_SIREN] ?? "").replace(/\s/g, "");
      // Excel supprime les zéros en tête : 55804124 redevient 055804124.
      if (/^[0-9]{1,8}$/.test(siren)) siren = siren.padStart(9, "0");
      resultat.push({ numero: i + 1, siren, maille: (cols[COL_MAILLE] ?? "").trim() });
    });
    return resultat;
  }

  $("#fichier").addEventListener("change", async e => {
    const f = e.target.files[0];
    $("#resultat-import").hidden = true;
    lignesLues = null;
    $("#importer").disabled = true;
    if (!f) { $("#fichier-info").textContent = "Aucun fichier choisi."; return; }
    lignesLues = extraireLignes(decoder(await f.arrayBuffer()));
    $("#fichier-info").textContent = `${f.name} : ${lignesLues.length} ligne${lignesLues.length > 1 ? "s" : ""} de données lue${lignesLues.length > 1 ? "s" : ""}.`;
    $("#importer").disabled = lignesLues.length === 0;
  });

  $("#importer").addEventListener("click", async () => {
    if (!lignesLues?.length) return;
    const btn = $("#importer");
    btn.disabled = true;
    btn.textContent = "Import en cours…";
    try {
      const r = await store.importer(lignesLues);
      etat.mailles.push(...r.ajoutees);
      etat.mailles.sort(tri);
      rendre();
      rendreExport();
      afficherResultat(r);
      $("#fichier").value = "";
      $("#fichier-info").textContent = "Aucun fichier choisi.";
      lignesLues = null;
    } catch (err) {
      toast(`${err.message}. Aucune maille n'a été ajoutée.`);
      btn.disabled = false;
    } finally {
      btn.textContent = "Importer";
    }
  });

  function afficherResultat({ ajoutees, dejaPresentes, rejets }) {
    const pl = (n, s) => `${n} ${s}${n > 1 ? "s" : ""}`;
    $("#resultat-chiffres").innerHTML = `
      <span class="chiffre ok"><b>${ajoutees.length}</b> ${ajoutees.length > 1 ? "mailles ajoutées" : "maille ajoutée"} en « Nouveau »</span>
      <span class="chiffre"><b>${dejaPresentes}</b> déjà présente${dejaPresentes > 1 ? "s" : ""}, inchangée${dejaPresentes > 1 ? "s" : ""}</span>
      <span class="chiffre ${rejets.length ? "ko" : ""}"><b>${rejets.length}</b> ligne${rejets.length > 1 ? "s" : ""} ignorée${rejets.length > 1 ? "s" : ""}</span>`;
    $("#resultat-ajoutees").innerHTML = ajoutees.length
      ? `<table><thead><tr><th>SIREN</th><th>Maille</th><th>Société</th></tr></thead><tbody>${ajoutees.map(m =>
          `<tr><td class="siren">${esc(formatSiren(m.siren))}</td><td class="maille">${esc(m.maille)}</td><td>${m.societe ? esc(m.societe) : '<span class="inconnue">Non renseignée</span>'}</td></tr>`).join("")}</tbody></table>`
      : "";
    $("#resultat-rejets").innerHTML = rejets.length
      ? `<p class="titre-rejets">Lignes ignorées</p><ul>${rejets.map(r => `<li>Ligne ${r.numero} : ${esc(r.raison)}</li>`).join("")}</ul>`
      : "";
    $("#resultat-import").hidden = false;
    toast(`Import terminé : ${pl(ajoutees.length, "maille")} ajoutée${ajoutees.length > 1 ? "s" : ""}`);
  }

  // --- Démarrage -------------------------------------------------------------
  async function charger() {
    try {
      etat.mailles = await store.lister();
    } catch (err) {
      $("#lignes").innerHTML = `<tr><td colspan="5" class="vide">${esc(err.message)}. Vérifiez que le site IIS est démarré puis rechargez la page.</td></tr>`;
      return;
    }
    etat.mailles.sort(tri);
    rendre();
    rendreExport();
  }
  afficherOnglet(location.hash === "#import" ? "import" : "mailles");
  charger();
})();
