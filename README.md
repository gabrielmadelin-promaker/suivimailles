# Suivi des mailles

Application web qui liste les mailles (Société, SIREN, Maille, Statut) et permet de qualifier chacune :
**Nouveau** (bleu), **Légitime** (vert), **Non légitime** (rouge).

- Filtre sur chaque colonne (insensible à la casse et aux accents ; le SIREN se filtre avec ou sans espaces).
- Bandeau au-dessus de la liste : nombre et part de mailles par statut. Il suit les filtres Société / SIREN / Maille ;
  un clic sur un compteur filtre la liste sur ce statut.
- Le statut se change directement dans la liste et est enregistré immédiatement.
- **Exporter vers Excel** : fichier `mailles-AAAA-MM-JJ.xlsx` des lignes affichées (filtres appliqués) avec société, SIREN
  (en texte, zéros conservés), maille, statut en couleur, date et auteur de la dernière modification. Le fichier est
  produit dans le navigateur, sans accès internet.
- Bouton corbeille sur chaque ligne : supprime la maille après confirmation (avertissement : suppression définitive,
  la maille sera recréée en « Nouveau » si elle figure encore dans un prochain import). Chaque suppression est tracée
  dans le journal de l'application.
- Onglet **Sociétés** : référentiel SOCIÉTÉ / SIREN. Le nom se modifie directement dans la liste (Entrée ou sortie du champ
  pour enregistrer, Échap pour annuler) et est reporté sur toutes les mailles du SIREN ; les mailles importées plus tard
  le reprennent aussi. Ajout manuel, filtres, lien vers les mailles du SIREN, et import d'un CSV `SOCIETE;SIREN`
  (colonnes repérées par l'en-tête) : SIREN inconnus ajoutés, noms des SIREN connus mis à jour.
  Tri par clic sur les en-têtes Société, SIREN et Mailles (nombre de mailles : du plus grand au plus petit d'abord).
- Onglet **Import / export** :
  - **Exporter siren.csv** : les SIREN distincts (mailles et sociétés du référentiel), un par ligne, sans en-tête.
  - **Ouvrir l'annuaire** : lien vers l'annuaire de la facturation électronique (https://facturation.chorus-pro.gouv.fr/annuaire), dans un nouvel onglet.
  - **Importer** `adresses_de_facturation.csv` : colonnes `SIREN, (non utilisée), (non utilisée), Adresse de facturation, (non utilisée)`.
    La 4ᵉ colonne est la maille. Seules les mailles absentes de la liste sont ajoutées, au statut « Nouveau » :
    une maille déjà présente (même code, sans tenir compte des majuscules ni des espaces) n'est pas importée et garde
    son statut ; le compte rendu liste ces mailles non importées. Un compte rendu liste les mailles ajoutées et les lignes ignorées
    (SIREN qui n'a pas 9 chiffres, maille vide). Séparateur `,` ou `;`, fichier UTF-8 ou Windows (Excel) ;
    un SIREN dont Excel a supprimé les zéros en tête est complété à 9 chiffres. La société n'étant pas dans le fichier,
    elle est reprise d'une maille existante du même SIREN, sinon laissée « Non renseignée ».

## Connexion et profils

- **Connexion par code (MFA)** : l'utilisateur saisit son adresse mail ; si elle est déclarée, un code de 10 caractères
  (majuscule, minuscule, chiffre, caractère spécial) lui est envoyé par mail. Le code est valable jusqu'à 23:59:59 le jour
  même, 5 essais au plus ; un nouveau code remplace le précédent (au plus un par minute). La session expire aussi à minuit.
  Seule l'empreinte SHA-256 du code est conservée (`App_Data/codes.json`).
- **Profils** : **Admin** (tous les onglets) et **User** (tous sauf Utilisateurs). Le profil est relu à chaque requête :
  un changement ou une suppression s'applique immédiatement. Impossible de se supprimer soi-même ou de retirer le dernier Admin.
- **SMTP** : `App_Data/smtp.json` (modèle `smtp.modele.json`, créé par le script d'installation). `DossierTest` dépose les
  mails en `.eml` au lieu de les envoyer. `Authentification:AdministrateurInitial` crée le premier administrateur.
- Toutes les routes `/api` exigent une session, sauf `/api/auth/*` et `/api/version` ; `/api/utilisateurs` exige Admin.

## Architecture

```
Navigateur ──HTTP──▶ IIS (ASP.NET Core Module V2, in-process)
                         └─ SuiviMailles.dll (ASP.NET Core 8, API minimale)
                               ├─ wwwroot/            interface (HTML/CSS/JS, sans framework)
                               └─ App_Data/mailles.json, societes.json   données (pas de base SQL)
```

| Appel | Rôle |
|---|---|
| `POST api/auth/code` — `{"email":"…"}` | Envoie un code d'accès (404 si l'adresse n'est pas déclarée) |
| `POST api/auth/connexion` — `{"email":"…","code":"…"}` | Ouvre la session (cookie jusqu'à minuit) |
| `GET  api/auth/moi`, `POST api/auth/deconnexion` | Session en cours, déconnexion |
| `GET/POST api/utilisateurs`, `POST api/utilisateurs/supprimer` | Gestion des utilisateurs (Admin) |
| `GET  api/mailles` | Liste des mailles |
| `POST api/mailles/{id}/statut` — corps `{"statut":"legitime"}` | Change le statut (`nouveau`, `legitime`, `non_legitime`) |
| `POST api/mailles/{id}/supprimer` | Supprime une maille |
| `GET  api/societes` | Référentiel des sociétés (SIREN, nom, nombre de mailles) |
| `POST api/societes` — corps `{"siren":"055804124","nom":"…"}` | Crée ou renomme une société (nom reporté sur ses mailles) |
| `POST api/societes/import` — corps `{"lignes":[{"numero":2,"siren":"…","nom":"…"}]}` | Import du référentiel |
| `GET  api/siren.csv` | Export des SIREN distincts |
| `POST api/mailles/import` — corps `{"lignes":[{"numero":2,"siren":"055804124","maille":"055804124_FILM"}]}` | Ajoute les mailles absentes (le CSV est lu dans le navigateur, le serveur revalide chaque ligne) |

Les données sont gardées en mémoire et le fichier JSON est réécrit à chaque modification
(écriture dans un `.tmp` puis remplacement, pour ne jamais laisser un fichier tronqué).
Si l'authentification Windows est activée sur le site, le compte qui modifie est enregistré dans `modifiePar`.

Au premier démarrage, si le fichier de données n'existe pas, il est créé à partir de `Data/mailles.seed.json`.
Ce fichier est construit depuis un export `adresses_de_facturation.csv` :
`node tools/seed-depuis-csv.mjs <adresses_de_facturation.csv> src/SuiviMailles/Data/mailles.seed.json`.
Le fichier de données n'est jamais publié : un redéploiement n'écrase pas les statuts saisis.

## Déploiement sur IIS (zip)

Comme pour l'application Titres, l'application s'installe à partir d'un zip :

1. Récupérer `SuiviMailles.zip` : fichier **`livraison/SuiviMailles.zip`** du dépôt (ouvrir le fichier sur GitHub,
   bouton « Download raw file »), remis à jour automatiquement après chaque modification. Autres possibilités :
   onglet **Actions** > dernière exécution « Zip d'installation » > artefact **SuiviMailles**, ou onglet **Releases**
   pour une version taguée.
2. Prérequis serveur, une seule fois : **ASP.NET Core 8 Hosting Bundle**, puis `iisreset`.
3. Dézipper sur le serveur et lancer en administrateur :
   `powershell -ExecutionPolicy Bypass -File .\Installer-SuiviMailles.ps1 -Administrateur prenom.nom@domaine.fr`,
   puis compléter `App_Data\smtp.json` (serveur SMTP) et lancer `Restart-WebAppPool SuiviMailles`.
4. Ouvrir http://localhost:8082/

Le script crée le pool (Aucun code managé), le site sur le port 8082 et les droits sur `App_Data`.
Relancé avec un nouveau zip, il fait la mise à jour sans toucher aux données ni à `appsettings.json`.
Détails et installation manuelle : `deploiement/LISEZMOI.txt`.

Le zip est construit par `.github/workflows/zip.yml`, qui vérifie aussi que l'API démarre et répond
(liste, statut, import, export, suppression) avant de le publier.

Pour garder les données hors du dossier du site, définir le chemin dans `appsettings.json` :

```json
"Stockage": { "Fichier": "D:\\Data\\SuiviMailles\\mailles.json" }
```

Pour démarrer avec une autre liste, régénérer `Data/mailles.seed.json` avant le premier démarrage,
ou importer le fichier depuis l'onglet Import / export.

## Artefact de test

`artefact/suivi-mailles.html` est une page autonome (interface + données de `mailles.seed.json`) qui tourne sans serveur ;
les changements de statut y sont gardés dans le navigateur. Elle se régénère depuis les sources :

```
node tools/construire-artefact.mjs artefact/suivi-mailles.html
```

## Développement local

```
dotnet run --project src/SuiviMailles
```
