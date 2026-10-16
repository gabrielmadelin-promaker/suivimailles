using System.Text.Json;

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
