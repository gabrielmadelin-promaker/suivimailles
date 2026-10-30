(() => {
  "use strict";

  const STATUTS = [
    { code: "nouveau", libelle: "Nouveau" },
    { code: "legitime", libelle: "Légitime" },
    { code: "non_legitime", libelle: "Non légitime" },
    { code: "a_supprimer", libelle: "À supprimer" },
    { code: "supprimee", libelle: "Supprimée" },
  ];
  const libelleStatut = Object.fromEntries(STATUTS.map(s => [s.code, s.libelle]));

  // --- Accès aux données -------------------------------------------------
  // En production (IIS) : API du serveur applicatif. Chemin relatif pour fonctionner aussi
  // dans une sous-application IIS (ex. https://serveur/suivimailles/).
  // Une réponse 401 (session expirée à minuit, utilisateur supprimé) ramène à l'écran de connexion.
  async function appel(url, options) {
    const r = await fetch(url, options);
    if (r.status === 401) {
      afficherConnexion("Votre session a expiré. Reconnectez-vous.");
      throw new Error("Session expirée");
    }
    return r;
  }
  const lireErreur = async (r, defaut) => {
    try { return (await r.json()).erreur || defaut; } catch { return defaut; }
  };
  const postJson = (url, corps) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });

  const apiStore = {
    demo: false,
    // Connexion
    async moi() {
      const r = await fetch("api/auth/moi", { headers: { Accept: "application/json" } });
      return r.ok ? r.json() : null;
    },
    async demanderCode(email) {
      const r = await postJson("api/auth/code", { email });
      if (!r.ok) throw new Error(await lireErreur(r, `Demande refusée (HTTP ${r.status})`));
      return r.json();
    },
    async seConnecter(email, code) {
      const r = await postJson("api/auth/connexion", { email, code });
      if (!r.ok) throw new Error(await lireErreur(r, `Connexion refusée (HTTP ${r.status})`));
      return r.json();
    },
    async seDeconnecter() { await fetch("api/auth/deconnexion", { method: "POST" }); },
    // Utilisateurs (profil Admin)
    async listerUtilisateurs() {
      const r = await appel("api/utilisateurs", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Chargement des utilisateurs impossible (HTTP ${r.status})`);
      return r.json();
    },
    async enregistrerUtilisateur(u) {
      const r = await appel("api/utilisateurs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) });
      if (!r.ok) throw new Error(await lireErreur(r, `Enregistrement refusé (HTTP ${r.status})`));
      return r.json();
    },
    async testerMail() {
      const r = await appel("api/utilisateurs/test-mail", { method: "POST" });
      if (!r.ok) throw new Error(`Test refusé (HTTP ${r.status})`);
      return r.json();
    },
    async supprimerUtilisateur(email) {
      const r = await appel("api/utilisateurs/supprimer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!r.ok) throw new Error(await lireErreur(r, `Suppression refusée (HTTP ${r.status})`));
    },
    async lister() {
      const r = await appel("api/mailles", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Chargement impossible (HTTP ${r.status})`);
      return r.json();
    },
    async changerStatut(id, statut) {
      const r = await appel(`api/mailles/${encodeURIComponent(id)}/statut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut }),
      });
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
    async supprimer(id) {
      const r = await appel(`api/mailles/${encodeURIComponent(id)}/supprimer`, { method: "POST" });
      // 404 : déjà supprimée par quelqu'un d'autre, le résultat attendu est atteint.
      if (!r.ok && r.status !== 404) throw new Error(`Suppression refusée par le serveur (HTTP ${r.status})`);
    },
    async listerSocietes() {
      const r = await appel("api/societes", { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`Chargement des sociétés impossible (HTTP ${r.status})`);
      return r.json();
    },
    async definirSociete(siren, nom) {
      const r = await appel("api/societes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, nom }),
      });
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
    async importerSocietes(lignes) {
      const r = await appel("api/societes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes }),
      });
      if (!r.ok) throw new Error(`Import refusé par le serveur (HTTP ${r.status})`);
      return r.json();
    },
    async importer(lignes) {
      const r = await appel("api/mailles/import", {
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
  const CLE_UTILISATEURS = "suivimailles-demo-utilisateurs-v1";
  const CLE_SESSION = "suivimailles-demo-session-v1";
  const lireLocal = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle) || "null") ?? defaut; } catch { return defaut; } };
  const ecrireLocal = (cle, val) => { try { localStorage.setItem(cle, JSON.stringify(val)); } catch { /* valable jusqu'au rechargement */ } };
  const utilisateursDemo = () => lireLocal(CLE_UTILISATEURS, [
    { email: "admin@exemple.fr", nom: "Administrateur", profil: "Admin", derniereConnexion: null },
    { email: "utilisateur@exemple.fr", nom: "Utilisateur", profil: "User", derniereConnexion: null },
  ]);
  const genererCode = () => {
    const maj = "ABCDEFGHJKLMNPQRSTUVWXYZ", min = "abcdefghijkmnopqrstuvwxyz", chi = "23456789", spe = "!#$%&*+-=?@", tous = maj + min + chi + spe;
    const tirer = t => t[crypto.getRandomValues(new Uint32Array(1))[0] % t.length];
    const c = [tirer(maj), tirer(min), tirer(chi), tirer(spe)];
    while (c.length < 10) c.push(tirer(tous));
    return c.sort(() => crypto.getRandomValues(new Uint8Array(1))[0] - 128).join("");
  };
  const finDeJournee = () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d.toISOString(); };
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
    // Connexion simulée : le code est affiché à l'écran au lieu d'être envoyé par mail.
    _code: null,
    async moi() {
      const s = lireLocal(CLE_SESSION, null);
      if (!s || new Date(s.expiration) < new Date()) return null;
      return utilisateursDemo().find(u => u.email === s.email) ?? null;
    },
    async demanderCode(email) {
      email = email.trim().toLowerCase();
      if (!utilisateursDemo().some(u => u.email === email))
        throw new Error("Cette adresse n'est pas déclarée dans l'application. Contactez un administrateur.");
      this._code = { email, code: genererCode(), expiration: finDeJournee(), echecs: 0 };
      return { expiration: this._code.expiration, codeDemo: this._code.code };
    },
    async seConnecter(email, code) {
      email = email.trim().toLowerCase();
      const c = this._code;
      if (!c || c.email !== email) throw new Error("Aucun code valide pour cette adresse. Demandez un nouveau code.");
      if (c.code !== code.trim()) {
        c.echecs++;
        const restantes = 5 - c.echecs;
        if (restantes <= 0) this._code = null;
        throw new Error(restantes > 0 ? `Code incorrect. Il reste ${restantes} essai${restantes > 1 ? "s" : ""}.` : "Code incorrect. Trop d'essais : demandez un nouveau code.");
      }
      const liste = utilisateursDemo();
      const u = liste.find(x => x.email === email);
      u.derniereConnexion = new Date().toISOString();
      ecrireLocal(CLE_UTILISATEURS, liste);
      ecrireLocal(CLE_SESSION, { email, expiration: c.expiration });
      return u;
    },
    async seDeconnecter() { try { localStorage.removeItem(CLE_SESSION); } catch { /* rien */ } },
    async listerUtilisateurs() { return utilisateursDemo().sort((a, b) => a.email.localeCompare(b.email)); },
    async enregistrerUtilisateur({ email, nom, profil }) {
      email = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Adresse mail invalide : ${email}`);
      const liste = utilisateursDemo();
      let u = liste.find(x => x.email === email);
      if (u?.profil === "Admin" && profil !== "Admin") {
        if (email === etat.moi?.email) throw new Error("Vous ne pouvez pas retirer votre propre profil Admin.");
        if (liste.filter(x => x.profil === "Admin").length === 1) throw new Error("Il doit rester au moins un administrateur.");
      }
      if (!u) { u = { email, derniereConnexion: null }; liste.push(u); }
      Object.assign(u, { nom: (nom || "").trim(), profil });
      ecrireLocal(CLE_UTILISATEURS, liste);
      return u;
    },
    async testerMail() {
      return { ok: true, destinataire: etat.moi.email, detail: null,
        parametres: { mode: "démonstration : aucun mail n'est envoyé", serveur: "smtp.exemple.fr", port: "587", ssl: "true", authentification: "compte@exemple.fr (mot de passe renseigné)", expediteur: "suivi-mailles@exemple.fr" } };
    },
    async supprimerUtilisateur(email) {
      const liste = utilisateursDemo();
      const u = liste.find(x => x.email === email);
      if (email === etat.moi?.email) throw new Error("Vous ne pouvez pas supprimer votre propre compte.");
      if (u?.profil === "Admin" && liste.filter(x => x.profil === "Admin").length === 1) throw new Error("Il doit rester au moins un administrateur.");
      ecrireLocal(CLE_UTILISATEURS, liste.filter(x => x.email !== email));
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
      try { for (const c of [CLE, CLE_SOCIETES, CLE_UTILISATEURS]) localStorage.removeItem(c); } catch { /* rien à faire */ }
    },
  };

  const store = window.SUIVI_DEMO_DATA ? demoStore : apiStore;

  // --- État ---------------------------------------------------------------
  const etat = {
    mailles: [], filtres: { societe: "", siren: "", maille: "", statut: "" },
    societes: [], filtresSocietes: { nom: "", siren: "" },
    // Tri de la liste des sociétés : colonne (nom, siren, nbMailles) et sens (1 croissant, -1 décroissant) ; null = ordre par défaut.
    triSocietes: { colonne: null, sens: 1 },
    moi: null, utilisateurs: [],
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

  // --- Fenêtre de confirmation (suppressions) -------------------------------------
  let confirmationEnCours = null, focusAvant = null;

  function ouvrirConfirmation({ titre, detail, avertissement, libelle, action }) {
    confirmationEnCours = action;
    focusAvant = document.activeElement;
    $("#conf-titre").textContent = titre;
    $("#conf-detail").innerHTML = detail;
    $("#conf-avert").textContent = avertissement;
    $("#conf-supprimer").textContent = libelle;
    $("#confirmation").hidden = false;
    $("#conf-annuler").focus();
  }

  function fermerConfirmation() {
    $("#confirmation").hidden = true;
    confirmationEnCours = null;
    focusAvant?.focus?.();
  }

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
    const action = confirmationEnCours;
    if (!action) return;
    const btn = $("#conf-supprimer");
    btn.disabled = true;
    try {
      if (await action() !== false) fermerConfirmation();
    } finally {
      btn.disabled = false;
    }
  });

  // Suppression d'une maille
  $("#lignes").addEventListener("click", e => {
    const btn = e.target.closest("button.supprimer");
    if (!btn) return;
    const maille = etat.mailles.find(m => m.id === btn.closest("tr").dataset.id);
    ouvrirConfirmation({
      titre: "Supprimer cette maille ?",
      detail: `
        <dt>Maille</dt><dd class="maille">${esc(maille.maille)}</dd>
        <dt>SIREN</dt><dd class="siren">${esc(formatSiren(maille.siren))}</dd>
        <dt>Société</dt><dd>${maille.societe ? esc(maille.societe) : '<span class="inconnue">Non renseignée</span>'}</dd>
        <dt>Statut</dt><dd><span class="pastille-statut ${esc(maille.statut)}">${libelleStatut[maille.statut]}</span></dd>`,
      avertissement: "La suppression est définitive : la maille et son statut seront effacés. Si elle figure encore dans adresses_de_facturation.csv, le prochain import la recréera au statut « Nouveau ».",
      libelle: "Supprimer définitivement",
      action: async () => {
        try {
          await store.supprimer(maille.id);
        } catch (err) {
          toast(`${err.message}. La maille n'a pas été supprimée.`);
          return false;
        }
        etat.mailles = etat.mailles.filter(m => m.id !== maille.id);
        rendre();
        rendreExport();
        toast(`Maille ${maille.maille} supprimée`);
        rafraichirSocietes();
      },
    });
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
    if (nom === "utilisateurs") chargerUtilisateurs();
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
    const styleStatut = { nouveau: 2, legitime: 3, non_legitime: 4, a_supprimer: 5, supprimee: 6 };
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
<fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1F5FD1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1D7A45"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFC0322B"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFB45309"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF5D6779"/><name val="Calibri"/></font></fonts>
<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EBF0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EEFC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F3E9"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE8E6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBD8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECEEF2"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="5" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="6" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
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
    const { colonne, sens } = etat.triSocietes;
    if (colonne) {
      const cmp = {
        nom: (a, b) => (!a.nom - !b.nom) || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }),
        siren: (a, b) => a.siren.localeCompare(b.siren),
        nbMailles: (a, b) => a.nbMailles - b.nbMailles,
      }[colonne];
      // À égalité, ordre alphabétique pour garder une liste stable.
      visibles.sort((a, b) => sens * cmp(a, b) || (!a.nom - !b.nom) || a.nom.localeCompare(b.nom, "fr") || a.siren.localeCompare(b.siren));
    }
    for (const th of document.querySelectorAll(".table-societes th[data-tri]")) {
      const actif = th.dataset.tri === colonne;
      th.setAttribute("aria-sort", actif ? (sens > 0 ? "ascending" : "descending") : "none");
      th.querySelector(".fleche").textContent = actif ? (sens > 0 ? "▲" : "▼") : "";
    }
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

  // Clic sur un en-tête : tri sur la colonne, puis sens inverse, puis retour à l'ordre par défaut.
  // Le nombre de mailles se trie d'abord du plus grand au plus petit.
  document.querySelector(".table-societes thead").addEventListener("click", e => {
    const btn = e.target.closest("button.tri");
    if (!btn) return;
    const col = btn.closest("th").dataset.tri;
    const premier = col === "nbMailles" ? -1 : 1;
    const t = etat.triSocietes;
    if (t.colonne !== col) etat.triSocietes = { colonne: col, sens: premier };
    else if (t.sens === premier) t.sens = -premier;
    else etat.triSocietes = { colonne: null, sens: 1 };
    rendreSocietes();
  });

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

  // --- Utilisateurs (profil Admin) ------------------------------------------------
  const dateHeure = iso => iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";

  async function chargerUtilisateurs() {
    try {
      etat.utilisateurs = await store.listerUtilisateurs();
    } catch (err) {
      $("#lignes-utilisateurs").innerHTML = `<tr><td colspan="5" class="vide">${esc(err.message)}</td></tr>`;
      return;
    }
    rendreUtilisateurs();
  }

  function rendreUtilisateurs() {
    const n = etat.utilisateurs.length, admins = etat.utilisateurs.filter(u => u.profil === "Admin").length;
    $("#compte-utilisateurs").textContent = `${n} utilisateur${n > 1 ? "s" : ""}, dont ${admins} administrateur${admins > 1 ? "s" : ""}`;
    $("#lignes-utilisateurs").innerHTML = etat.utilisateurs.map(u => {
      const moi = u.email === etat.moi?.email;
      return `
      <tr data-email="${esc(u.email)}">
        <td class="email">${esc(u.email)}${moi ? ' <span class="vous">vous</span>' : ""}</td>
        <td><input class="nom-utilisateur" type="text" value="${esc(u.nom || "")}" data-initial="${esc(u.nom || "")}" placeholder="Nom" aria-label="Nom de ${esc(u.email)}" autocomplete="off"></td>
        <td><select class="profil-utilisateur" aria-label="Profil de ${esc(u.email)}"${moi ? " disabled title=\"Vous ne pouvez pas modifier votre propre profil\"" : ""}>
          <option value="User"${u.profil === "User" ? " selected" : ""}>User</option>
          <option value="Admin"${u.profil === "Admin" ? " selected" : ""}>Admin</option>
        </select></td>
        <td class="date">${dateHeure(u.derniereConnexion) || '<span class="inconnue">Jamais</span>'}</td>
        <td class="col-actions">${moi ? "" : `<button type="button" class="supprimer" title="Supprimer cet utilisateur" aria-label="Supprimer ${esc(u.email)}">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 1.5h4a.5.5 0 0 1 .5.5v1H14v1.5h-1l-.7 9.1a1.5 1.5 0 0 1-1.5 1.4H5.2a1.5 1.5 0 0 1-1.5-1.4L3 4.5H2V3h3.5V2a.5.5 0 0 1 .5-.5Zm-1.5 3 .7 9h5.6l.7-9h-7Zm2 1.5h1v6h-1v-6Zm2 0h1v6h-1v-6Z"/></svg></button>`}</td>
      </tr>`;
    }).join("");
  }

  async function enregistrerUtilisateur(u, message) {
    try {
      const maj = await store.enregistrerUtilisateur(u);
      const i = etat.utilisateurs.findIndex(x => x.email === maj.email);
      if (i >= 0) etat.utilisateurs[i] = maj; else etat.utilisateurs.push(maj);
      etat.utilisateurs.sort((a, b) => a.email.localeCompare(b.email));
      toast(message(maj));
      return true;
    } catch (err) {
      toast(`${err.message}`);
      return false;
    }
  }

  $("#form-utilisateur").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#ajout-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Saisissez une adresse mail valide."); $("#ajout-email").focus(); return; }
    const existait = etat.utilisateurs.some(u => u.email === email);
    if (await enregistrerUtilisateur({ email, nom: $("#ajout-nom-utilisateur").value, profil: $("#ajout-profil").value },
      u => existait ? `${u.email} mis à jour (${u.profil})` : `${u.email} ajouté (${u.profil})`)) {
      $("#form-utilisateur").reset();
      rendreUtilisateurs();
      $("#ajout-email").focus();
    }
  });

  $("#lignes-utilisateurs").addEventListener("change", async e => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const u = etat.utilisateurs.find(x => x.email === tr.dataset.email);
    if (e.target.matches("select.profil-utilisateur")) {
      const ok = await enregistrerUtilisateur({ email: u.email, nom: u.nom, profil: e.target.value }, x => `${x.email} : profil ${x.profil}`);
      if (!ok) e.target.value = u.profil;
      rendreUtilisateurs();
    }
    if (e.target.matches("input.nom-utilisateur")) {
      const nom = e.target.value.trim();
      if (nom === e.target.dataset.initial) return;
      if (await enregistrerUtilisateur({ email: u.email, nom, profil: u.profil }, x => `${x.email} : nom enregistré`)) e.target.dataset.initial = nom;
      else e.target.value = e.target.dataset.initial;
    }
  });
  $("#lignes-utilisateurs").addEventListener("keydown", e => {
    const champ = e.target.closest("input.nom-utilisateur");
    if (!champ) return;
    if (e.key === "Enter") champ.blur();
    if (e.key === "Escape") { champ.value = champ.dataset.initial; champ.blur(); }
  });
  $("#lignes-utilisateurs").addEventListener("click", e => {
    const btn = e.target.closest("button.supprimer");
    if (!btn) return;
    const u = etat.utilisateurs.find(x => x.email === btn.closest("tr").dataset.email);
    ouvrirConfirmation({
      titre: "Supprimer cet utilisateur ?",
      detail: `<dt>Adresse</dt><dd>${esc(u.email)}</dd><dt>Nom</dt><dd>${u.nom ? esc(u.nom) : '<span class="inconnue">Non renseigné</span>'}</dd>
        <dt>Profil</dt><dd>${esc(u.profil)}</dd>`,
      avertissement: "Cette personne ne pourra plus se connecter : sa session en cours est coupée immédiatement. Elle pourra être déclarée de nouveau plus tard.",
      libelle: "Supprimer l'utilisateur",
      action: async () => {
        try {
          await store.supprimerUtilisateur(u.email);
        } catch (err) {
          toast(err.message);
          return false;
        }
        etat.utilisateurs = etat.utilisateurs.filter(x => x.email !== u.email);
        rendreUtilisateurs();
        toast(`${u.email} supprimé`);
      },
    });
  });

  $("#tester-mail").addEventListener("click", async () => {
    const btn = $("#tester-mail");
    btn.disabled = true;
    btn.textContent = "Envoi en cours…";
    try {
      const r = await store.testerMail();
      const p = r.parametres || {};
      $("#resultat-test").innerHTML = `
        <p class="connexion-message ${r.ok ? "info" : "erreur"}">${r.ok
          ? `Le serveur SMTP a accepté le mail de test pour <b>${esc(r.destinataire)}</b>. S'il n'arrive pas d'ici quelques minutes, il est bloqué après le serveur : regardez les courriers indésirables ou la quarantaine, et vérifiez que l'expéditeur est autorisé.`
          : `Échec de l'envoi à <b>${esc(r.destinataire)}</b> : ${esc(r.detail)}`}</p>
        <dl class="conf-detail">
          <dt>Mode</dt><dd>${esc(p.mode ?? "")}</dd>
          <dt>Serveur</dt><dd>${esc(p.serveur ?? "(vide)")}</dd>
          <dt>Port</dt><dd>${esc(p.port ?? "(vide : 25)")}</dd>
          <dt>Ssl</dt><dd>${esc(p.ssl ?? "(vide : false)")}</dd>
          <dt>Authentification</dt><dd>${esc(p.authentification ?? "")}</dd>
          <dt>Expéditeur</dt><dd>${esc(p.expediteur ?? "(vide)")}</dd>
        </dl>`;
      $("#resultat-test").hidden = false;
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Tester l'envoi des mails";
    }
  });

  // --- Connexion par code envoyé par mail -------------------------------------------
  let emailConnexion = "";

  function afficherConnexion(message = "") {
    etat.moi = null;
    $("#application").hidden = true;
    $("#confirmation").hidden = true;
    $("#ecran-connexion").hidden = false;
    $("#etape-code").hidden = true;
    $("#etape-email").hidden = false;
    messageConnexion(message, "info");
    $("#connexion-email").focus();
  }

  function messageConnexion(texte, type = "erreur") {
    const m = $("#connexion-message");
    m.textContent = texte;
    m.className = `connexion-message ${type}`;
    m.hidden = !texte;
  }

  async function envoyerCode() {
    const email = $("#connexion-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { messageConnexion("Saisissez une adresse mail valide."); return; }
    const btn = $("#bouton-code");
    btn.disabled = true;
    messageConnexion("");
    try {
      const r = await store.demanderCode(email);
      emailConnexion = email;
      $("#code-destinataire").textContent = email;
      $("#etape-email").hidden = true;
      $("#etape-code").hidden = false;
      $("#connexion-code").value = "";
      $("#connexion-code").focus();
      $("#code-demo").hidden = !r.codeDemo;
      if (r.codeDemo) $("#code-demo").innerHTML = `Démonstration : le mail contiendrait le code <code>${esc(r.codeDemo)}</code>`;
      messageConnexion(`Code envoyé. Il est valable jusqu'à 23 h 59 aujourd'hui.`, "info");
    } catch (err) {
      messageConnexion(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  $("#form-email").addEventListener("submit", e => { e.preventDefault(); envoyerCode(); });
  $("#renvoyer-code").addEventListener("click", async () => {
    $("#connexion-email").value = emailConnexion;
    $("#etape-code").hidden = true;
    $("#etape-email").hidden = false;
    await envoyerCode();
  });
  $("#changer-email").addEventListener("click", () => {
    $("#etape-code").hidden = true;
    $("#etape-email").hidden = false;
    messageConnexion("");
    $("#connexion-email").focus();
  });
  $("#form-code").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("#connexion-code").value.trim();
    if (!code) return;
    const btn = $("#bouton-connexion");
    btn.disabled = true;
    try {
      const u = await store.seConnecter(emailConnexion, code);
      ouvrirApplication(u);
    } catch (err) {
      messageConnexion(err.message);
      $("#connexion-code").select();
    } finally {
      btn.disabled = false;
    }
  });
  $("#deconnexion").addEventListener("click", async () => {
    await store.seDeconnecter();
    afficherConnexion("Vous êtes déconnecté.");
  });

  function ouvrirApplication(u) {
    etat.moi = u;
    $("#ecran-connexion").hidden = true;
    $("#application").hidden = false;
    $("#session-email").textContent = u.nom ? `${u.nom} (${u.email})` : u.email;
    $("#session-profil").textContent = u.profil;
    const admin = u.profil === "Admin";
    $('.onglet[data-onglet="utilisateurs"]').hidden = !admin;
    const demande = location.hash.slice(1);
    afficherOnglet(["societes", "import"].includes(demande) || (admin && demande === "utilisateurs") ? demande : "mailles");
    charger();
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
    await rafraichirSocietes();
  }
  if (!store.demo) {
    fetch("api/version").then(r => r.ok ? r.json() : null).then(v => {
      if (v?.version) { $("#version").textContent = `Version ${v.version}`; $("#version").hidden = false; }
    }).catch(() => { /* sans importance */ });
  }
  store.moi().then(u => u ? ouvrirApplication(u) : afficherConnexion()).catch(() => afficherConnexion());
})();
