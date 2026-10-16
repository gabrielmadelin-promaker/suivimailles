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
