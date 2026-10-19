using System.Text.Json;
using System.Text.RegularExpressions;

namespace SuiviMailles;

/// <summary>
/// Stockage des mailles (mailles.json) et du référentiel des sociétés (societes.json) sur le serveur applicatif (pas de base SQL).
/// Le nom de la société est recopié sur chaque maille du SIREN, pour que mailles.json reste lisible seul.
/// Stockage dans des fichiers JSON sur le serveur applicatif (pas de base SQL).
/// Les données sont gardées en mémoire ; chaque modification réécrit le fichier de façon atomique.
/// </summary>
public sealed class MailleStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _fichier;
    private readonly string _fichierSocietes;
    private readonly Dictionary<string, string> _societes = new();
    private readonly SemaphoreSlim _verrou = new(1, 1);
    private readonly ILogger<MailleStore> _logger;
    private List<LigneMaille> _mailles;

    public MailleStore(IConfiguration config, IWebHostEnvironment env, ILogger<MailleStore> logger)
    {
        _logger = logger;
        _fichier = Path.GetFullPath(config["Stockage:Fichier"] ?? "App_Data/mailles.json", env.ContentRootPath);
        var seed = Path.GetFullPath(config["Stockage:Seed"] ?? "Data/mailles.seed.json", env.ContentRootPath);

        Directory.CreateDirectory(Path.GetDirectoryName(_fichier)!);
        if (!File.Exists(_fichier) && File.Exists(seed))
        {
            File.Copy(seed, _fichier);
            _logger.LogInformation("Fichier de données initialisé depuis {Seed}", seed);
        }

        _mailles = File.Exists(_fichier)
            ? JsonSerializer.Deserialize<List<LigneMaille>>(File.ReadAllText(_fichier), Json) ?? []
            : [];
        _logger.LogInformation("{Nombre} mailles chargées depuis {Fichier}", _mailles.Count, _fichier);

        _fichierSocietes = Path.Combine(Path.GetDirectoryName(_fichier)!, "societes.json");
        if (File.Exists(_fichierSocietes))
        {
            foreach (var s in JsonSerializer.Deserialize<List<Societe>>(File.ReadAllText(_fichierSocietes), Json) ?? [])
                _societes[s.Siren] = s.Nom;
        }
        else
        {
            // Première version du référentiel : reprise des noms déjà saisis sur les mailles.
            foreach (var m in _mailles.Where(m => m.Societe != ""))
                _societes.TryAdd(m.Siren, m.Societe);
            EcrireAsync(_fichierSocietes, SocietesAPlat()).GetAwaiter().GetResult();
        }
    }

    public async Task<IReadOnlyList<LigneMaille>> ListerAsync()
    {
        await _verrou.WaitAsync();
        try { return _mailles.ToList(); }
        finally { _verrou.Release(); }
    }

    public async Task<LigneMaille?> ChangerStatutAsync(string id, string statut, string? utilisateur)
    {
        await _verrou.WaitAsync();
        try
        {
            var maille = _mailles.FirstOrDefault(m => m.Id == id);
            if (maille is null) return null;

            maille.Statut = statut;
            maille.ModifieLe = DateTimeOffset.Now;
            maille.ModifiePar = utilisateur;
            await EcrireAsync();
            return maille;
        }
        finally { _verrou.Release(); }
    }

    public async Task<LigneMaille?> SupprimerAsync(string id, string? utilisateur)
    {
        await _verrou.WaitAsync();
        try
        {
            var maille = _mailles.FirstOrDefault(m => m.Id == id);
            if (maille is null) return null;

            _mailles.Remove(maille);
            await EcrireAsync();
            _logger.LogWarning("Maille supprimée : {Id} {Siren} {Maille} (statut {Statut}) par {Utilisateur}",
                maille.Id, maille.Siren, maille.Maille, maille.Statut, utilisateur ?? "anonyme");
            return maille;
        }
        finally { _verrou.Release(); }
    }

    public async Task<IReadOnlyList<string>> SirensAsync()
    {
        await _verrou.WaitAsync();
        try { return _mailles.Select(m => m.Siren).Distinct().Order(StringComparer.Ordinal).ToList(); }
        finally { _verrou.Release(); }
    }

    /// <summary>
    /// Ajoute les mailles absentes, au statut Nouveau. Une maille déjà présente (même code, sans tenir compte
    /// des majuscules ni des espaces autour, quel que soit le SIREN) ou en double dans le fichier n'est pas importée :
    /// la maille existante et son statut restent inchangés.
    /// </summary>
    public async Task<ResultatImport> ImporterAsync(IEnumerable<LigneImport> lignes, string? utilisateur)
    {
        await _verrou.WaitAsync();
        try
        {
            var connues = new HashSet<string>(_mailles.Select(m => m.Maille.Trim()), StringComparer.OrdinalIgnoreCase);
            var prochainId = _mailles.Select(m => int.TryParse(m.Id, out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
            var ajoutees = new List<LigneMaille>();
            var rejets = new List<Rejet>();
            var nonImportees = new List<MailleExistante>();

            foreach (var ligne in lignes)
            {
                var siren = Regex.Replace(ligne.Siren ?? "", @"\s", "");
                var maille = (ligne.Maille ?? "").Trim();
                if (!Regex.IsMatch(siren, @"^[0-9]{9}$")) { rejets.Add(new(ligne.Numero, siren.Length == 0 ? "SIREN manquant" : $"SIREN invalide « {ligne.Siren} »")); continue; }
                if (maille.Length == 0) { rejets.Add(new(ligne.Numero, "Maille vide")); continue; }
                if (!connues.Add(maille)) { nonImportees.Add(new(ligne.Numero, maille)); continue; }

                var nouvelle = new LigneMaille
                {
                    Id = (prochainId++).ToString("0000"),
                    // La société n'est pas dans le fichier d'import : elle vient du référentiel des sociétés.
                    Societe = _societes.GetValueOrDefault(siren, ""),
                    Siren = siren,
                    Maille = maille,
                    Statut = Statuts.Nouveau,
                    ModifieLe = DateTimeOffset.Now,
                    ModifiePar = utilisateur,
                };
                _mailles.Add(nouvelle);
                ajoutees.Add(nouvelle);
            }

            if (ajoutees.Count > 0) await EcrireAsync();
            _logger.LogInformation("Import : {Ajoutees} ajoutées, {Deja} déjà présentes, {Rejets} rejetées", ajoutees.Count, nonImportees.Count, rejets.Count);
            return new ResultatImport(ajoutees, nonImportees.Count, nonImportees, rejets);
        }
        finally { _verrou.Release(); }
    }

    public async Task<IReadOnlyList<SocieteVue>> ListerSocietesAsync()
    {
        await _verrou.WaitAsync();
        try
        {
            var nbMailles = _mailles.GroupBy(m => m.Siren).ToDictionary(g => g.Key, g => g.Count());
            return _societes.Keys.Union(nbMailles.Keys)
                .Select(siren => new SocieteVue(siren, _societes.GetValueOrDefault(siren, ""), nbMailles.GetValueOrDefault(siren)))
                .OrderBy(s => s.Nom == "").ThenBy(s => s.Nom, StringComparer.CurrentCultureIgnoreCase).ThenBy(s => s.Siren)
                .ToList();
        }
        finally { _verrou.Release(); }
    }

    /// <summary>Crée ou renomme une société ; le nom est reporté sur toutes les mailles du SIREN.</summary>
    public async Task<SocieteVue?> DefinirSocieteAsync(string siren, string nom)
    {
        siren = Regex.Replace(siren ?? "", @"\s", "");
        if (!Regex.IsMatch(siren, @"^[0-9]{9}$")) return null;

        await _verrou.WaitAsync();
        try
        {
            Appliquer(siren, (nom ?? "").Trim());
            await EcrireAsync(_fichierSocietes, SocietesAPlat());
            await EcrireAsync();
            return new SocieteVue(siren, _societes.GetValueOrDefault(siren, ""), _mailles.Count(m => m.Siren == siren));
        }
        finally { _verrou.Release(); }
    }

    /// <summary>Ajoute les SIREN inconnus et met à jour le nom des SIREN connus.</summary>
    public async Task<ResultatImportSocietes> ImporterSocietesAsync(IEnumerable<LigneImportSociete> lignes)
    {
        await _verrou.WaitAsync();
        try
        {
            int ajoutees = 0, modifiees = 0, inchangees = 0;
            var rejets = new List<Rejet>();
            foreach (var ligne in lignes)
            {
                var siren = Regex.Replace(ligne.Siren ?? "", @"\s", "");
                var nom = (ligne.Nom ?? "").Trim();
                if (!Regex.IsMatch(siren, @"^[0-9]{9}$")) { rejets.Add(new(ligne.Numero, siren.Length == 0 ? "SIREN manquant" : $"SIREN invalide « {ligne.Siren} »")); continue; }
                if (nom.Length == 0) { rejets.Add(new(ligne.Numero, "Nom de société vide")); continue; }

                if (!_societes.TryGetValue(siren, out var actuel)) ajoutees++;
                else if (actuel == nom) { inchangees++; continue; }
                else modifiees++;
                Appliquer(siren, nom);
            }

            if (ajoutees + modifiees > 0)
            {
                await EcrireAsync(_fichierSocietes, SocietesAPlat());
                await EcrireAsync();
            }
            _logger.LogInformation("Import sociétés : {Ajoutees} ajoutées, {Modifiees} modifiées, {Inchangees} inchangées, {Rejets} rejetées",
                ajoutees, modifiees, inchangees, rejets.Count);
            return new ResultatImportSocietes(ajoutees, modifiees, inchangees, rejets);
        }
        finally { _verrou.Release(); }
    }

    private void Appliquer(string siren, string nom)
    {
        if (nom.Length == 0) _societes.Remove(siren);
        else _societes[siren] = nom;
        foreach (var m in _mailles.Where(m => m.Siren == siren)) m.Societe = nom;
    }

    private Task EcrireAsync() => EcrireAsync(_fichier, _mailles);

    private List<Societe> SocietesAPlat() =>
        _societes.Select(kv => new Societe(kv.Key, kv.Value)).OrderBy(s => s.Siren, StringComparer.Ordinal).ToList();

    private static async Task EcrireAsync<T>(string fichier, T contenu)
    {
        // Écriture dans un fichier temporaire puis remplacement : un arrêt du pool IIS en pleine écriture
        // ne laisse jamais un fichier tronqué.
        var tmp = fichier + ".tmp";
        await using (var flux = File.Create(tmp))
        {
            await JsonSerializer.SerializeAsync(flux, contenu, Json);
        }
        File.Move(tmp, fichier, overwrite: true);
    }
}
