using SuiviMailles;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<MailleStore>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api/mailles");

api.MapGet("/", async (MailleStore store) => Results.Ok(await store.ListerAsync()));

// POST plutôt que PUT/DELETE : WebDAV, souvent installé sur les serveurs IIS, intercepte PUT et DELETE.
api.MapPost("/{id}/statut", async (string id, ChangementStatut corps, MailleStore store, HttpContext http) =>
{
    if (!Statuts.Tous.Contains(corps.Statut))
        return Results.BadRequest(new { erreur = $"Statut inconnu : {corps.Statut}" });

    // Renseigné si l'authentification Windows est activée sur le site IIS.
    var utilisateur = http.User.Identity?.IsAuthenticated == true ? http.User.Identity.Name : null;

    var maille = await store.ChangerStatutAsync(id, corps.Statut, utilisateur);
    return maille is null ? Results.NotFound() : Results.Ok(maille);
});

api.MapPost("/{id}/supprimer", async (string id, MailleStore store, HttpContext http) =>
{
    var utilisateur = http.User.Identity?.IsAuthenticated == true ? http.User.Identity.Name : null;
    return await store.SupprimerAsync(id, utilisateur) is null ? Results.NotFound() : Results.NoContent();
});

// Un SIREN par ligne, sans en-tête.
app.MapGet("/api/siren.csv", async (MailleStore store) =>
{
    var sirens = await store.SirensAsync();
    var contenu = string.Concat(sirens.Select(s => s + "\r\n"));
    return Results.File(System.Text.Encoding.UTF8.GetBytes(contenu), "text/csv; charset=utf-8", "siren.csv");
});

// Le fichier adresses_de_facturation.csv est lu dans le navigateur ; le serveur reçoit les couples (SIREN, maille)
// et revalide chaque ligne.
api.MapPost("/import", async (DemandeImport demande, MailleStore store, HttpContext http) =>
{
    if (demande.Lignes is null || demande.Lignes.Count == 0)
        return Results.BadRequest(new { erreur = "Aucune ligne à importer." });

    var utilisateur = http.User.Identity?.IsAuthenticated == true ? http.User.Identity.Name : null;
    return Results.Ok(await store.ImporterAsync(demande.Lignes, utilisateur));
});

app.Run();
