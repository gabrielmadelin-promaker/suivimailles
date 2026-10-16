using System.Text.Json;
using System.Text.RegularExpressions;

namespace SuiviMailles;

/// <summary>
/// Stockage des mailles dans un fichier JSON sur le serveur applicatif (pas de base SQL).
/// Les données sont gardées en mémoire ; chaque modification réécrit le fichier de façon atomique.
/// </summary>
public sealed class MailleStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _fichier;
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

    public async Task<IReadOnlyList<string>> SirensAsync()
    {
        await _verrou.WaitAsync();
        try { return _mailles.Select(m => m.Siren).Distinct().Order(StringComparer.Ordinal).ToList(); }
        finally { _verrou.Release(); }
    }

    /// <summary>
    /// Ajoute les couples (SIREN, maille) absents, au statut Nouveau. Une maille déjà connue pour ce SIREN
    /// (y compris en double dans le même fichier) n'est jamais modifiée, son statut est conservé.
    /// </summary>
    public async Task<ResultatImport> ImporterAsync(IEnumerable<LigneImport> lignes, string? utilisateur)
    {
        await _verrou.WaitAsync();
        try
        {
            var connues = new HashSet<string>(_mailles.Select(m => Cle(m.Siren, m.Maille)), StringComparer.OrdinalIgnoreCase);
            var prochainId = _mailles.Select(m => int.TryParse(m.Id, out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
            var ajoutees = new List<LigneMaille>();
            var rejets = new List<Rejet>();
            var dejaPresentes = 0;

            foreach (var ligne in lignes)
            {
                var siren = Regex.Replace(ligne.Siren ?? "", @"\s", "");
                var maille = (ligne.Maille ?? "").Trim();
                if (!Regex.IsMatch(siren, @"^[0-9]{9}$")) { rejets.Add(new(ligne.Numero, $"SIREN invalide « {ligne.Siren} »")); continue; }
                if (maille.Length == 0) { rejets.Add(new(ligne.Numero, "Maille vide")); continue; }
                if (!connues.Add(Cle(siren, maille))) { dejaPresentes++; continue; }

                var nouvelle = new LigneMaille
                {
                    Id = (prochainId++).ToString("0000"),
                    // La société n'est pas dans le fichier d'import : reprise d'une maille existante du même SIREN si possible.
                    Societe = _mailles.FirstOrDefault(m => m.Siren == siren && m.Societe != "")?.Societe ?? "",
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
            _logger.LogInformation("Import : {Ajoutees} ajoutées, {Deja} déjà présentes, {Rejets} rejetées", ajoutees.Count, dejaPresentes, rejets.Count);
            return new ResultatImport(ajoutees, dejaPresentes, rejets);
        }
        finally { _verrou.Release(); }
    }

    private static string Cle(string siren, string maille) => $"{siren}|{maille.Trim()}";

    private async Task EcrireAsync()
    {
        // Écriture dans un fichier temporaire puis remplacement : un arrêt du pool IIS en pleine écriture
        // ne laisse jamais un fichier tronqué.
        var tmp = _fichier + ".tmp";
        await using (var flux = File.Create(tmp))
        {
            await JsonSerializer.SerializeAsync(flux, _mailles, Json);
        }
        File.Move(tmp, _fichier, overwrite: true);
    }
}
