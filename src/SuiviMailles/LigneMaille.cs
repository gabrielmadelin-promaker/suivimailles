using System.Text.Json.Serialization;

namespace SuiviMailles;

public sealed class LigneMaille
{
    public required string Id { get; init; }
    public required string Societe { get; set; }
    public required string Siren { get; set; }
    public required string Maille { get; set; }
    public string Statut { get; set; } = Statuts.Nouveau;
    public DateTimeOffset? ModifieLe { get; set; }
    public string? ModifiePar { get; set; }
}

public static class Statuts
{
    public const string Nouveau = "nouveau";
    public const string Legitime = "legitime";
    public const string NonLegitime = "non_legitime";

    public static readonly IReadOnlySet<string> Tous = new HashSet<string> { Nouveau, Legitime, NonLegitime };
}

public sealed record ChangementStatut([property: JsonPropertyName("statut")] string Statut);

public sealed record LigneImport(int Numero, string Siren, string Maille);

public sealed record DemandeImport(IReadOnlyList<LigneImport> Lignes);

public sealed record Rejet(int Numero, string Raison);

public sealed record MailleExistante(int Numero, string Maille);

public sealed record ResultatImport(IReadOnlyList<LigneMaille> Ajoutees, int DejaPresentes, IReadOnlyList<MailleExistante> NonImportees, IReadOnlyList<Rejet> Rejets);

/// <summary>Référentiel des sociétés : un nom par SIREN.</summary>
public sealed record Societe(string Siren, string Nom);

public sealed record SocieteVue(string Siren, string Nom, int NbMailles);

public sealed record LigneImportSociete(int Numero, string Siren, string Nom);

public sealed record DemandeImportSocietes(IReadOnlyList<LigneImportSociete> Lignes);

public sealed record ResultatImportSocietes(int Ajoutees, int Modifiees, int Inchangees, IReadOnlyList<Rejet> Rejets);
