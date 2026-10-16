# Suivi des mailles

Application web qui liste les mailles (Société, SIREN, Maille, Statut) et permet de qualifier chacune :
**Nouveau** (bleu), **Légitime** (vert), **Non légitime** (rouge).

- Filtre sur chaque colonne (insensible à la casse et aux accents ; le SIREN se filtre avec ou sans espaces).
- Bandeau au-dessus de la liste : nombre et part de mailles par statut. Il suit les filtres Société / SIREN / Maille ;
  un clic sur un compteur filtre la liste sur ce statut.
- Le statut se change directement dans la liste et est enregistré immédiatement.

## Architecture

```
Navigateur ──HTTP──▶ IIS (ASP.NET Core Module V2, in-process)
                         └─ SuiviMailles.dll (ASP.NET Core 8, API minimale)
                               ├─ wwwroot/            interface (HTML/CSS/JS, sans framework)
                               └─ App_Data/mailles.json   données (pas de base SQL)
```

| Appel | Rôle |
|---|---|
| `GET  api/mailles` | Liste des mailles |
| `PUT  api/mailles/{id}/statut` — corps `{"statut":"legitime"}` | Change le statut (`nouveau`, `legitime`, `non_legitime`) |

Les données sont gardées en mémoire et le fichier JSON est réécrit à chaque modification
(écriture dans un `.tmp` puis remplacement, pour ne jamais laisser un fichier tronqué).
Si l'authentification Windows est activée sur le site, le compte qui modifie est enregistré dans `modifiePar`.

Au premier démarrage, si le fichier de données n'existe pas, il est créé à partir de `Data/mailles.seed.json`.
Le fichier de données n'est jamais publié : un redéploiement n'écrase pas les statuts saisis.

## Déploiement sur IIS

1. Installer le **ASP.NET Core 8 Hosting Bundle** sur le serveur, puis `iisreset`.
2. Publier : `dotnet publish src/SuiviMailles -c Release -o publish`
3. Copier `publish/` dans le dossier du site (ex. `D:\Sites\SuiviMailles`).
4. Dans IIS : créer le site ou l'application, pool d'applications en **Aucun code managé**.
5. Donner au compte du pool (`IIS AppPool\<nom du pool>`) le droit **Modifier** sur le dossier de données
   (`App_Data` par défaut).

Pour garder les données hors du dossier du site, définir le chemin dans `appsettings.json` :

```json
"Stockage": { "Fichier": "D:\\Data\\SuiviMailles\\mailles.json" }
```

Remplacer `Data/mailles.seed.json` par la vraie liste avant le premier démarrage, ou déposer directement
le fichier de données au même format.

## Artefact de test

`artefact/suivi-mailles.html` est une page autonome (interface + données fictives) qui tourne sans serveur ;
les changements de statut y sont gardés dans le navigateur. Elle se régénère depuis les sources :

```
node tools/generer-seed.mjs src/SuiviMailles/Data/mailles.seed.json   # données fictives
node tools/construire-artefact.mjs artefact/suivi-mailles.html
```

## Développement local

```
dotnet run --project src/SuiviMailles
```
