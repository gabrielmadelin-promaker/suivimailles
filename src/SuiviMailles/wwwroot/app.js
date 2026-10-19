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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut }),
      });
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
    async supprimer(id) {
      const r = await fetch(`api/mailles/${encodeURIComponent(id)}/supprimer`, { method: "POST" });
      // 404 : déjà supprimée par quelqu'un d'autre, le résultat attendu est atteint.
      if (!r.ok && r.status !== 404) throw new Error(`Suppression refusée par le serveur (HTTP ${r.status})`);
    },
    async listerSocietes() {
      const r = await fetch("api/societes", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Chargement des sociétés impossible (HTTP ${r.status})`);
      return r.json();
    },
    async definirSociete(siren, nom) {
      const r = await fetch("api/societes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, nom }),
      });
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
    async importerSocietes(lignes) {
      const r = await fetch("api/societes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes }),
      });
      if (!r.ok) throw new Error(`Import refusé par le serveur (HTTP ${r.status})`);
      return r.json();
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
  const CLE_SOCIETES = "suivimailles-demo-societes-v1";
  const demoStore = {
    demo: true,
    _donnees: [],
    _societes: {},
    _sauver() {
      try {
        localStorage.setItem(CLE, JSON.stringify(this._donnees));
        localStorage.setItem(CLE_SOCIETES, JSON.stringify(this._societes));
      } catch { /* valable jusqu'au rechargement */ }
    },
    async lister() {
      let sauvees = null, societes = null;
      try {
        sauvees = JSON.parse(localStorage.getItem(CLE) || "null");
        societes = JSON.parse(localStorage.getItem(CLE_SOCIETES) || "null");
      } catch { /* stockage indisponible */ }
      this._donnees = Array.isArray(sauvees) ? sauvees : structuredClone(window.SUIVI_DEMO_DATA || []);
      this._societes = societes && typeof societes === "object" ? societes : {};
      return structuredClone(this._donnees);
    },
    // Mêmes règles que MailleStore côté serveur (référentiel SIREN -> nom, recopié sur les mailles).
    async listerSocietes() {
      const nb = {};
      for (const m of this._donnees) nb[m.siren] = (nb[m.siren] || 0) + 1;
      const sirens = new Set([...Object.keys(this._societes), ...Object.keys(nb)]);
      return [...sirens].map(siren => ({ siren, nom: this._societes[siren] || "", nbMailles: nb[siren] || 0 }))
        .sort((a, b) => (!a.nom - !b.nom) || a.nom.localeCompare(b.nom, "fr") || a.siren.localeCompare(b.siren));
    },
    _appliquer(siren, nom) {
      if (nom) this._societes[siren] = nom; else delete this._societes[siren];
      for (const m of this._donnees) if (m.siren === siren) m.societe = nom;
    },
    async definirSociete(siren, nom) {
      if (!/^[0-9]{9}$/.test(siren)) throw new Error("SIREN invalide");
      this._appliquer(siren, nom.trim());
      this._sauver();
      return { siren, nom: this._societes[siren] || "", nbMailles: this._donnees.filter(m => m.siren === siren).length };
    },
    async importerSocietes(lignes) {
      let ajoutees = 0, modifiees = 0, inchangees = 0;
      const rejets = [];
      for (const l of lignes) {
        const siren = String(l.siren).replace(/\s/g, ""), nom = String(l.nom).trim();
        if (!/^[0-9]{9}$/.test(siren)) { rejets.push({ numero: l.numero, raison: siren ? `SIREN invalide « ${l.siren} »` : "SIREN manquant" }); continue; }
        if (!nom) { rejets.push({ numero: l.numero, raison: "Nom de société vide" }); continue; }
        const actuel = this._societes[siren];
        if (actuel === undefined) ajoutees++;
        else if (actuel === nom) { inchangees++; continue; }
        else modifiees++;
        this._appliquer(siren, nom);
      }
      if (ajoutees + modifiees) this._sauver();
      return { ajoutees, modifiees, inchangees, rejets };
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
      const cle = maille => maille.trim().toLowerCase();
      const connues = new Set(this._donnees.map(m => cle(m.maille)));
      let prochainId = Math.max(0, ...this._donnees.map(m => parseInt(m.id, 10) || 0)) + 1;
      const ajoutees = [], rejets = [];
      const nonImportees = [];
      for (const l of lignes) {
        const siren = String(l.siren).replace(/\s/g, "");
        const maille = String(l.maille).trim();
        if (!/^[0-9]{9}$/.test(siren)) { rejets.push({ numero: l.numero, raison: siren ? `SIREN invalide « ${l.siren} »` : "SIREN manquant" }); continue; }
        if (!maille) { rejets.push({ numero: l.numero, raison: "Maille vide" }); continue; }
        if (connues.has(cle(maille))) { nonImportees.push({ numero: l.numero, maille }); continue; }
        connues.add(cle(maille));
        const m = {
          id: String(prochainId++).padStart(4, "0"),
          societe: this._societes[siren] || "",
          siren, maille, statut: "nouveau", modifieLe: new Date().toISOString(),
        };
        this._donnees.push(m);
        ajoutees.push(structuredClone(m));
      }
      if (ajoutees.length) this._sauver();
      return { ajoutees, dejaPresentes: nonImportees.length, nonImportees, rejets };
    },
    reinitialiser() {
      try { localStorage.removeItem(CLE); localStorage.removeItem(CLE_SOCIETES); } catch { /* rien à faire */ }
    },
  };

  const store = window.SUIVI_DEMO_DATA ? demoStore : apiStore;

  // --- État ---------------------------------------------------------------
  const etat = {
    mailles: [], filtres: { societe: "", siren: "", maille: "", statut: "" },
    societes: [], filtresSocietes: { nom: "", siren: "" },
  };

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

  const maillesAffichees = () => etat.mailles.filter(m => correspond(m, etat.filtres) && (!etat.filtres.statut || m.statut === etat.filtres.statut));
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
    $("#exporter-excel").textContent = visibles.length === etat.mailles.length
      ? "Exporter vers Excel" : `Exporter les ${visibles.length} lignes vers Excel`;
    $("#exporter-excel").disabled = !visibles.length;

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
      rafraichirSocietes();
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
    if (nom === "societes") rendreSocietes();
  }
  document.querySelector(".onglets").addEventListener("click", e => {
    const b = e.target.closest(".onglet");
    if (!b) return;
    afficherOnglet(b.dataset.onglet);
    try { history.replaceState(null, "", `#${b.dataset.onglet}`); } catch { /* sans importance */ }
  });

  // --- Export des SIREN ----------------------------------------------------------
  // SIREN des mailles et des sociétés (une société ajoutée sans maille doit aussi être recherchée dans l'annuaire).
  const sirensDistincts = () => [...new Set([...etat.mailles.map(m => m.siren), ...etat.societes.map(s => s.siren)])].sort();

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
      rafraichirSocietes();
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

  function afficherResultat({ ajoutees, nonImportees, rejets }) {
    const dejaPresentes = nonImportees.length;
    const pl = (n, s) => `${n} ${s}${n > 1 ? "s" : ""}`;
    $("#resultat-chiffres").innerHTML = `
      <span class="chiffre ok"><b>${ajoutees.length}</b> ${ajoutees.length > 1 ? "mailles ajoutées" : "maille ajoutée"} en « Nouveau »</span>
      <span class="chiffre"><b>${dejaPresentes}</b> déjà présente${dejaPresentes > 1 ? "s" : ""}, non importée${dejaPresentes > 1 ? "s" : ""}</span>
      <span class="chiffre ${rejets.length ? "ko" : ""}"><b>${rejets.length}</b> ligne${rejets.length > 1 ? "s" : ""} ignorée${rejets.length > 1 ? "s" : ""}</span>`;
    $("#resultat-ajoutees").innerHTML = ajoutees.length
      ? `<table><thead><tr><th>SIREN</th><th>Maille</th><th>Société</th></tr></thead><tbody>${ajoutees.map(m =>
          `<tr><td class="siren">${esc(formatSiren(m.siren))}</td><td class="maille">${esc(m.maille)}</td><td>${m.societe ? esc(m.societe) : '<span class="inconnue">Non renseignée</span>'}</td></tr>`).join("")}</tbody></table>`
      : "";
    $("#resultat-rejets").innerHTML = (rejets.length
      ? `<p class="titre-rejets">Lignes ignorées</p><ul>${rejets.map(r => `<li>Ligne ${r.numero} : ${esc(r.raison)}</li>`).join("")}</ul>`
      : "") + (dejaPresentes
      ? `<details class="deja"><summary>${dejaPresentes} maille${dejaPresentes > 1 ? "s" : ""} déjà présente${dejaPresentes > 1 ? "s" : ""}, non importée${dejaPresentes > 1 ? "s" : ""} (statut conservé)</summary>
           <ul>${nonImportees.map(x => `<li>Ligne ${x.numero} : <span class="maille">${esc(x.maille)}</span></li>`).join("")}</ul></details>`
      : "");
    $("#resultat-import").hidden = false;
    toast(`Import terminé : ${pl(ajoutees.length, "maille")} ajoutée${ajoutees.length > 1 ? "s" : ""}`);
  }

  // --- Export Excel des mailles ---------------------------------------------------
  // Fichier .xlsx écrit directement dans le navigateur (pas de bibliothèque, pas d'accès internet requis).
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = octets => {
    let c = 0xFFFFFFFF;
    for (const b of octets) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  // Archive zip sans compression : suffisant pour Excel et beaucoup plus simple.
  function zip(fichiers) {
    const enc = new TextEncoder(), parties = [], central = [];
    let decalage = 0;
    for (const [nom, contenu] of Object.entries(fichiers)) {
      const n = enc.encode(nom), d = enc.encode(contenu), crc = crc32(d);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint32(14, crc, true); local.setUint32(18, d.length, true); local.setUint32(22, d.length, true);
      local.setUint16(26, n.length, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, d.length, true); cd.setUint32(24, d.length, true);
      cd.setUint16(28, n.length, true); cd.setUint32(42, decalage, true);
      parties.push(new Uint8Array(local.buffer), n, d);
      central.push(new Uint8Array(cd.buffer), n);
      decalage += 30 + n.length + d.length;
    }
    const tailleCentral = central.reduce((t, x) => t + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    const nb = Object.keys(fichiers).length;
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, nb, true); fin.setUint16(10, nb, true);
    fin.setUint32(12, tailleCentral, true); fin.setUint32(16, decalage, true);
    return new Blob([...parties, ...central, new Uint8Array(fin.buffer)],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const xml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const dateFr = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  };

  function classeurMailles(mailles) {
    // Styles : 1 = en-tête, 2/3/4 = statut Nouveau / Légitime / Non légitime (couleurs de l'application).
    const styleStatut = { nouveau: 2, legitime: 3, non_legitime: 4 };
    const colonnes = [["Société", 34], ["SIREN", 13], ["Maille", 42], ["Statut", 15], ["Modifié le", 17], ["Modifié par", 22]];
    const lettres = "ABCDEF";
    const cellule = (ref, valeur, style = 0) =>
      `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xml(valeur)}</t></is></c>`;
    const lignes = [
      `<row r="1">${colonnes.map(([titre], i) => cellule(`${lettres[i]}1`, titre, 1)).join("")}</row>`,
      ...mailles.map((m, i) => {
        const r = i + 2;
        // Le SIREN reste du texte pour garder les zéros en tête.
        return `<row r="${r}">${cellule(`A${r}`, m.societe)}${cellule(`B${r}`, m.siren)}${cellule(`C${r}`, m.maille)}` +
          `${cellule(`D${r}`, libelleStatut[m.statut] ?? m.statut, styleStatut[m.statut])}${cellule(`E${r}`, dateFr(m.modifieLe))}${cellule(`F${r}`, m.modifiePar)}</row>`;
      }),
    ];
    const derniere = mailles.length + 1;
    const feuille = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${colonnes.map(([, l], i) => `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join("")}</cols>
<sheetData>${lignes.join("")}</sheetData>
<autoFilter ref="A1:F${derniere}"/>
</worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1F5FD1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1D7A45"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFC0322B"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EBF0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EEFC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F3E9"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE8E6"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    return zip({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Mailles" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Mailles!$A$1:$F$${derniere}</definedName></definedNames>
</workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      "xl/worksheets/sheet1.xml": feuille,
      "xl/styles.xml": styles,
    });
  }

  async function telecharger(nom, blob) {
    if (!store.demo) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: nom });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    }
    const downloads = await window.claude?.use?.("downloads");
    if (!downloads) { toast("Le téléchargement n'est pas disponible dans cet aperçu."); return false; }
    try {
      await downloads.save({ filename: nom, data: blob });
      return true;
    } catch (err) {
      if (err?.code !== "declined") toast("Le fichier n'a pas pu être enregistré.");
      return false;
    }
  }

  $("#exporter-excel").addEventListener("click", async () => {
    const lignes = maillesAffichees();
    if (!lignes.length) { toast("Aucune maille à exporter avec ces filtres."); return; }
    const jour = new Date().toISOString().slice(0, 10);
    if (await telecharger(`mailles-${jour}.xlsx`, classeurMailles(lignes)))
      toast(`${lignes.length} maille${lignes.length > 1 ? "s" : ""} exportée${lignes.length > 1 ? "s" : ""} vers Excel`);
  });

  // --- Sociétés ------------------------------------------------------------------
  async function rafraichirSocietes() {
    try {
      etat.societes = await store.listerSocietes();
    } catch (err) {
      $("#lignes-societes").innerHTML = `<tr><td colspan="3" class="vide">${esc(err.message)}</td></tr>`;
      return;
    }
    rendreSocietes();
    rendreExport();
  }

  function compterSocietes(nbVisibles = etat.societes.length) {
    const total = etat.societes.length, sansNom = etat.societes.filter(s => !s.nom).length;
    $("#compte-societes").textContent = `${total} société${total > 1 ? "s" : ""}` +
      (sansNom ? `, dont ${sansNom} sans nom` : "") +
      (nbVisibles !== total ? ` · ${nbVisibles} affichée${nbVisibles > 1 ? "s" : ""}` : "");
  }

  function rendreSocietes() {
    const f = etat.filtresSocietes;
    const visibles = etat.societes.filter(s => norm(s.nom).includes(norm(f.nom)) && sansEspaces(s.siren).includes(sansEspaces(f.siren)));
    compterSocietes(visibles.length);
    $("#lignes-societes").innerHTML = visibles.length ? visibles.map(s => `
      <tr data-siren="${esc(s.siren)}">
        <td><input class="nom-societe" type="text" value="${esc(s.nom)}" data-initial="${esc(s.nom)}" placeholder="Saisir le nom de la société"
             aria-label="Nom de la société ${esc(formatSiren(s.siren))}" autocomplete="off"></td>
        <td class="siren">${surligner(formatSiren(s.siren), f.siren, true)}</td>
        <td class="nb">${s.nbMailles
          ? `<button type="button" class="lien-mailles" title="Voir les mailles de ce SIREN">${s.nbMailles} maille${s.nbMailles > 1 ? "s" : ""}</button>`
          : '<span class="inconnue">Aucune</span>'}</td>
      </tr>`).join("")
      : `<tr><td colspan="3" class="vide">${etat.societes.length ? "Aucune société ne correspond aux filtres." : "Aucune société : importez un fichier ou ajoutez-en une ci-dessus."}</td></tr>`;
  }

  // Reporte le nom sur les mailles déjà chargées, sans recharger la page.
  function reporterNom(siren, nom) {
    for (const m of etat.mailles) if (m.siren === siren) m.societe = nom;
    etat.mailles.sort(tri);
    rendre();
    const s = etat.societes.find(x => x.siren === siren);
    if (s) s.nom = nom;
  }

  async function enregistrerSociete(siren, nom) {
    const vue = await store.definirSociete(siren, nom);
    reporterNom(vue.siren, vue.nom);
    if (!etat.societes.some(x => x.siren === vue.siren)) etat.societes.push(vue);
    rendreExport();
    return vue;
  }

  for (const champ of ["nom", "siren"]) {
    $(`#fs-${champ}`).addEventListener("input", e => { etat.filtresSocietes[champ] = e.target.value; rendreSocietes(); });
  }

  // Renommage directement dans la liste : enregistré quand on quitte le champ ou avec Entrée ; Échap annule.
  $("#lignes-societes").addEventListener("keydown", e => {
    const champ = e.target.closest("input.nom-societe");
    if (!champ) return;
    if (e.key === "Enter") champ.blur();
    if (e.key === "Escape") { champ.value = champ.dataset.initial; champ.blur(); }
  });
  $("#lignes-societes").addEventListener("change", async e => {
    const champ = e.target.closest("input.nom-societe");
    if (!champ) return;
    const siren = champ.closest("tr").dataset.siren;
    const nom = champ.value.trim();
    if (nom === champ.dataset.initial) return;
    champ.setAttribute("aria-busy", "true");
    try {
      await enregistrerSociete(siren, nom);
      champ.dataset.initial = nom;
      champ.value = nom;
      // Pas de nouveau rendu de la liste ici : le focus est peut-être déjà dans la ligne suivante.
      compterSocietes(document.querySelectorAll("#lignes-societes tr[data-siren]").length);
      const nb = etat.mailles.filter(m => m.siren === siren).length;
      toast(nom ? `${formatSiren(siren)} : « ${nom} »${nb ? `, reporté sur ${nb} maille${nb > 1 ? "s" : ""}` : ""}` : `Nom effacé pour ${formatSiren(siren)}`);
    } catch (err) {
      champ.value = champ.dataset.initial;
      toast(`${err.message}. Le nom n'a pas été modifié.`);
    } finally {
      champ.removeAttribute("aria-busy");
    }
  });
  $("#lignes-societes").addEventListener("click", e => {
    const btn = e.target.closest("button.lien-mailles");
    if (!btn) return;
    const siren = btn.closest("tr").dataset.siren;
    etat.filtres = { societe: "", siren, maille: "", statut: "" };
    for (const id of ["f-societe", "f-maille", "f-statut"]) $(`#${id}`).value = "";
    $("#f-siren").value = siren;
    rendre();
    afficherOnglet("mailles");
    try { history.replaceState(null, "", "#mailles"); } catch { /* sans importance */ }
  });

  $("#form-societe").addEventListener("submit", async e => {
    e.preventDefault();
    let siren = $("#ajout-siren").value.replace(/\s/g, "");
    const nom = $("#ajout-nom").value.trim();
    if (!/^[0-9]{9}$/.test(siren)) { toast("Le SIREN doit comporter 9 chiffres."); $("#ajout-siren").focus(); return; }
    if (!nom) { toast("Saisissez le nom de la société."); $("#ajout-nom").focus(); return; }
    const existait = etat.societes.find(x => x.siren === siren);
    try {
      await enregistrerSociete(siren, nom);
      etat.societes = await store.listerSocietes();
      rendreSocietes();
      $("#form-societe").reset();
      $("#ajout-siren").focus();
      toast(existait?.nom ? `Société ${formatSiren(siren)} renommée en « ${nom} »` : `Société « ${nom} » ajoutée`);
    } catch (err) {
      toast(`${err.message}. La société n'a pas été enregistrée.`);
    }
  });

  // Import du référentiel : colonnes SOCIETE et SIREN, repérées par l'en-tête (sinon société puis SIREN).
  let societesLues = null;

  function extraireSocietes(texte) {
    const brutes = lireCsv(texte);
    if (!brutes.length) return [];
    const entete = brutes[0].map(norm);
    let colSiren = entete.findIndex(c => c.includes("siren"));
    let colNom = entete.findIndex(c => /soci|raison|nom/.test(c));
    const aEntete = colSiren >= 0 || colNom >= 0;
    if (colSiren < 0 || colNom < 0) {
      // Sans en-tête reconnu : la colonne qui ne contient que des chiffres est le SIREN.
      const exemple = brutes[aEntete ? 1 : 0] || [];
      const premiereNumerique = /^[0-9\s]+$/.test(exemple[0] ?? "");
      colSiren = premiereNumerique ? 0 : 1;
      colNom = premiereNumerique ? 1 : 0;
    }
    const resultat = [];
    brutes.forEach((cols, i) => {
      if (i === 0 && aEntete) return;
      if (cols.every(c => !c.trim())) return;
      let siren = (cols[colSiren] ?? "").replace(/\s/g, "");
      if (/^[0-9]{1,8}$/.test(siren)) siren = siren.padStart(9, "0");
      resultat.push({ numero: i + 1, siren, nom: (cols[colNom] ?? "").trim() });
    });
    return resultat;
  }

  $("#fichier-soc").addEventListener("change", async e => {
    const f = e.target.files[0];
    $("#resultat-soc").hidden = true;
    societesLues = null;
    $("#importer-soc").disabled = true;
    if (!f) { $("#fichier-soc-info").textContent = "Aucun fichier choisi."; return; }
    societesLues = extraireSocietes(decoder(await f.arrayBuffer()));
    $("#fichier-soc-info").textContent = `${f.name} : ${societesLues.length} ligne${societesLues.length > 1 ? "s" : ""} de données lue${societesLues.length > 1 ? "s" : ""}.`;
    $("#importer-soc").disabled = societesLues.length === 0;
  });

  $("#importer-soc").addEventListener("click", async () => {
    if (!societesLues?.length) return;
    const btn = $("#importer-soc");
    btn.disabled = true;
    btn.textContent = "Import en cours…";
    try {
      const r = await store.importerSocietes(societesLues);
      etat.mailles = await store.lister();
      etat.mailles.sort(tri);
      rendre();
      await rafraichirSocietes();
      $("#resultat-soc-chiffres").innerHTML = `
        <span class="chiffre ok"><b>${r.ajoutees}</b> ajoutée${r.ajoutees > 1 ? "s" : ""}</span>
        <span class="chiffre ok"><b>${r.modifiees}</b> renommée${r.modifiees > 1 ? "s" : ""}</span>
        <span class="chiffre"><b>${r.inchangees}</b> inchangée${r.inchangees > 1 ? "s" : ""}</span>
        <span class="chiffre ${r.rejets.length ? "ko" : ""}"><b>${r.rejets.length}</b> ligne${r.rejets.length > 1 ? "s" : ""} ignorée${r.rejets.length > 1 ? "s" : ""}</span>`;
      $("#resultat-soc-rejets").innerHTML = r.rejets.length
        ? `<p class="titre-rejets">Lignes ignorées</p><ul>${r.rejets.map(x => `<li>Ligne ${x.numero} : ${esc(x.raison)}</li>`).join("")}</ul>`
        : "";
      $("#resultat-soc").hidden = false;
      $("#fichier-soc").value = "";
      $("#fichier-soc-info").textContent = "Aucun fichier choisi.";
      societesLues = null;
      toast(`Import terminé : ${r.ajoutees + r.modifiees} société${r.ajoutees + r.modifiees > 1 ? "s" : ""} enregistrée${r.ajoutees + r.modifiees > 1 ? "s" : ""}`);
    } catch (err) {
      toast(`${err.message}. Aucune société n'a été modifiée.`);
      btn.disabled = false;
    } finally {
      btn.textContent = "Importer";
    }
  });

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
    await rafraichirSocietes();
  }
  if (!store.demo) {
    fetch("api/version").then(r => r.ok ? r.json() : null).then(v => {
      if (v?.version) { $("#version").textContent = `Version ${v.version}`; $("#version").hidden = false; }
    }).catch(() => { /* sans importance */ });
  }
  afficherOnglet(["#societes", "#import"].includes(location.hash) ? location.hash.slice(1) : "mailles");
  charger();
})();
