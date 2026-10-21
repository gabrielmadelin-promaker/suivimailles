using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SuiviMailles;

public static class Profils
{
    public const string Admin = "Admin";
    public const string User = "User";

    public static readonly IReadOnlySet<string> Tous = new HashSet<string> { Admin, User };
}

public sealed class Utilisateur
{
    public required string Email { get; init; }
    public string Nom { get; set; } = "";
    public string Profil { get; set; } = Profils.User;
    public DateTimeOffset? DerniereConnexion { get; set; }
}

public sealed record DemandeCode(string Email);
public sealed record DemandeConnexion(string Email, string Code);
public sealed record UtilisateurSaisi(string Email, string? Nom, string Profil);

/// <summary>Code d'accès en cours pour une adresse : seule son empreinte est conservée.</summary>
public sealed class CodeAcces
{
    public required string Empreinte { get; init; }
    public required DateTimeOffset Expiration { get; init; }
    public DateTimeOffset DemandeLe { get; init; }
    public int Echecs { get; set; }
}

public enum ResultatDemande { Envoye, Inconnu, TropRapproche }

public sealed record ResultatConnexion(Utilisateur? Utilisateur, string? Erreur);

/// <summary>
/// Utilisateurs déclarés (utilisateurs.json) et codes d'accès du jour (codes.json), dans le dossier de données.
/// </summary>
public sealed class UtilisateurStore
{
    public const int EchecsMax = 5;
    public static readonly TimeSpan DelaiEntreDemandes = TimeSpan.FromSeconds(60);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly Regex FormatEmail = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    private readonly string _fichierUtilisateurs;
    private readonly string _fichierCodes;
    private readonly SemaphoreSlim _verrou = new(1, 1);
    private readonly ILogger<UtilisateurStore> _logger;
    private readonly List<Utilisateur> _utilisateurs;
    private readonly Dictionary<string, CodeAcces> _codes;

    public UtilisateurStore(IConfiguration config, IWebHostEnvironment env, ILogger<UtilisateurStore> logger)
    {
        _logger = logger;
        var dossier = Path.GetDirectoryName(Path.GetFullPath(config["Stockage:Fichier"] ?? "App_Data/mailles.json", env.ContentRootPath))!;
        Directory.CreateDirectory(dossier);
        _fichierUtilisateurs = Path.Combine(dossier, "utilisateurs.json");
        _fichierCodes = Path.Combine(dossier, "codes.json");

        _utilisateurs = File.Exists(_fichierUtilisateurs)
            ? JsonSerializer.Deserialize<List<Utilisateur>>(File.ReadAllText(_fichierUtilisateurs), Json) ?? []
            : [];
        _codes = File.Exists(_fichierCodes)
            ? JsonSerializer.Deserialize<Dictionary<string, CodeAcces>>(File.ReadAllText(_fichierCodes), Json) ?? new()
            : new();

        // Premier démarrage : l'administrateur initial déclaré dans smtp.json permet d'ouvrir l'application.
        var initial = Normaliser(config["Authentification:AdministrateurInitial"]);
        if (!_utilisateurs.Any(u => u.Profil == Profils.Admin) && FormatEmail.IsMatch(initial))
        {
            _utilisateurs.RemoveAll(u => u.Email == initial);
            _utilisateurs.Add(new Utilisateur { Email = initial, Nom = "Administrateur", Profil = Profils.Admin });
            Ecrire(_fichierUtilisateurs, _utilisateurs).GetAwaiter().GetResult();
            _logger.LogInformation("Administrateur initial créé : {Email}", initial);
        }
        if (!_utilisateurs.Any(u => u.Profil == Profils.Admin))
            _logger.LogWarning("Aucun administrateur déclaré : renseignez Authentification:AdministrateurInitial dans smtp.json.");
    }

    public static string Normaliser(string? email) => (email ?? "").Trim().ToLowerInvariant();
    public static bool EmailValide(string email) => FormatEmail.IsMatch(email);

    public async Task<Utilisateur?> TrouverAsync(string? email)
    {
        var e = Normaliser(email);
        await _verrou.WaitAsync();
        try { return _utilisateurs.FirstOrDefault(u => u.Email == e); }
        finally { _verrou.Release(); }
    }

    // ---- Codes d'accès ----

    /// <summary>
    /// Crée un nouveau code pour un utilisateur déclaré (il remplace le précédent), valable jusqu'à 23:59:59 le jour même.
    /// </summary>
    public async Task<(ResultatDemande Resultat, string? Code, DateTimeOffset Expiration)> CreerCodeAsync(string email)
    {
        var e = Normaliser(email);
        await _verrou.WaitAsync();
        try
        {
            if (!_utilisateurs.Any(u => u.Email == e)) return (ResultatDemande.Inconnu, null, default);
            var maintenant = DateTimeOffset.Now;
            if (_codes.TryGetValue(e, out var actuel) && maintenant - actuel.DemandeLe < DelaiEntreDemandes)
                return (ResultatDemande.TropRapproche, null, default);

            var code = GenererCode();
            var expiration = new DateTimeOffset(DateTime.Today.AddDays(1).AddTicks(-1));
            _codes[e] = new CodeAcces { Empreinte = Empreinte(e, code), Expiration = expiration, DemandeLe = maintenant };
            Purger();
            await Ecrire(_fichierCodes, _codes);
            return (ResultatDemande.Envoye, code, expiration);
        }
        finally { _verrou.Release(); }
    }

    /// <summary>Annule un code qui n'a pas pu être envoyé, pour permettre une nouvelle demande immédiate.</summary>
    public async Task AnnulerCodeAsync(string email)
    {
        await _verrou.WaitAsync();
        try { if (_codes.Remove(Normaliser(email))) await Ecrire(_fichierCodes, _codes); }
        finally { _verrou.Release(); }
    }

    /// <summary>Vérifie le code ; il reste utilisable jusqu'à son expiration, sauf après 5 erreurs.</summary>
    public async Task<ResultatConnexion> VerifierAsync(string email, string code)
    {
        var e = Normaliser(email);
        await _verrou.WaitAsync();
        try
        {
            var utilisateur = _utilisateurs.FirstOrDefault(u => u.Email == e);
            if (utilisateur is null || !_codes.TryGetValue(e, out var acces) || acces.Expiration < DateTimeOffset.Now)
                return new(null, "Aucun code valide pour cette adresse. Demandez un nouveau code.");

            var attendu = Convert.FromHexString(acces.Empreinte);
            var recu = Convert.FromHexString(Empreinte(e, (code ?? "").Trim()));
            if (!CryptographicOperations.FixedTimeEquals(attendu, recu))
            {
                acces.Echecs++;
                var restantes = EchecsMax - acces.Echecs;
                if (restantes <= 0) _codes.Remove(e);
                await Ecrire(_fichierCodes, _codes);
                _logger.LogWarning("Code erroné pour {Email} ({Echecs} échec(s))", e, acces.Echecs);
                return new(null, restantes > 0
                    ? $"Code incorrect. Il reste {restantes} essai{(restantes > 1 ? "s" : "")}."
                    : "Code incorrect. Trop d'essais : demandez un nouveau code.");
            }

            acces.Echecs = 0;
            utilisateur.DerniereConnexion = DateTimeOffset.Now;
            await Ecrire(_fichierCodes, _codes);
            await Ecrire(_fichierUtilisateurs, _utilisateurs);
            _logger.LogInformation("Connexion de {Email}", e);
            return new(utilisateur, null);
        }
        finally { _verrou.Release(); }
    }

    private static string GenererCode()
    {
        // Caractères ambigus exclus (0/O, 1/l/I) ; au moins une majuscule, une minuscule, un chiffre et un caractère spécial.
        const string maj = "ABCDEFGHJKLMNPQRSTUVWXYZ", min = "abcdefghijkmnopqrstuvwxyz", chiffres = "23456789", speciaux = "!#$%&*+-=?@";
        var tous = maj + min + chiffres + speciaux;
        var c = new List<char>
        {
            maj[RandomNumberGenerator.GetInt32(maj.Length)], min[RandomNumberGenerator.GetInt32(min.Length)],
            chiffres[RandomNumberGenerator.GetInt32(chiffres.Length)], speciaux[RandomNumberGenerator.GetInt32(speciaux.Length)],
        };
        while (c.Count < 10) c.Add(tous[RandomNumberGenerator.GetInt32(tous.Length)]);
        for (var i = c.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (c[i], c[j]) = (c[j], c[i]);
        }
        return new string(c.ToArray());
    }

    private static string Empreinte(string email, string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{email}\n{code}")));

    private void Purger()
    {
        foreach (var cle in _codes.Where(kv => kv.Value.Expiration < DateTimeOffset.Now).Select(kv => kv.Key).ToList())
            _codes.Remove(cle);
    }

    // ---- Gestion des utilisateurs (profil Admin) ----

    public async Task<IReadOnlyList<Utilisateur>> ListerAsync()
    {
        await _verrou.WaitAsync();
        try { return _utilisateurs.OrderBy(u => u.Email, StringComparer.Ordinal).ToList(); }
        finally { _verrou.Release(); }
    }

    public async Task<(Utilisateur? Utilisateur, string? Erreur)> EnregistrerAsync(UtilisateurSaisi saisie, string auteur)
    {
        var email = Normaliser(saisie.Email);
        if (!EmailValide(email)) return (null, $"Adresse mail invalide : {saisie.Email}");
        if (!Profils.Tous.Contains(saisie.Profil)) return (null, $"Profil inconnu : {saisie.Profil}");

        await _verrou.WaitAsync();
        try
        {
            var u = _utilisateurs.FirstOrDefault(x => x.Email == email);
            if (u is not null && u.Profil == Profils.Admin && saisie.Profil != Profils.Admin)
            {
                if (email == Normaliser(auteur)) return (null, "Vous ne pouvez pas retirer votre propre profil Admin.");
                if (_utilisateurs.Count(x => x.Profil == Profils.Admin) == 1) return (null, "Il doit rester au moins un administrateur.");
            }
            if (u is null)
            {
                u = new Utilisateur { Email = email };
                _utilisateurs.Add(u);
            }
            u.Nom = (saisie.Nom ?? "").Trim();
            u.Profil = saisie.Profil;
            await Ecrire(_fichierUtilisateurs, _utilisateurs);
            _logger.LogInformation("Utilisateur {Email} enregistré ({Profil}) par {Auteur}", email, u.Profil, auteur);
            return (u, null);
        }
        finally { _verrou.Release(); }
    }

    public async Task<string?> SupprimerAsync(string email, string auteur)
    {
        var e = Normaliser(email);
        await _verrou.WaitAsync();
        try
        {
            var u = _utilisateurs.FirstOrDefault(x => x.Email == e);
            if (u is null) return null;
            if (e == Normaliser(auteur)) return "Vous ne pouvez pas supprimer votre propre compte.";
            if (u.Profil == Profils.Admin && _utilisateurs.Count(x => x.Profil == Profils.Admin) == 1)
                return "Il doit rester au moins un administrateur.";
            _utilisateurs.Remove(u);
            _codes.Remove(e);
            await Ecrire(_fichierUtilisateurs, _utilisateurs);
            await Ecrire(_fichierCodes, _codes);
            _logger.LogWarning("Utilisateur {Email} supprimé par {Auteur}", e, auteur);
            return null;
        }
        finally { _verrou.Release(); }
    }

    private static async Task Ecrire<T>(string fichier, T contenu)
    {
        var tmp = fichier + ".tmp";
        await using (var flux = File.Create(tmp))
        {
            await JsonSerializer.SerializeAsync(flux, contenu, Json);
        }
        File.Move(tmp, fichier, overwrite: true);
    }
}
