using SuiviMailles;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<MailleStore>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api/mailles");

api.MapGet("/", async (MailleStore store) => Results.Ok(await store.ListerAsync()));

api.MapPut("/{id}/statut", async (string id, ChangementStatut corps, MailleStore store, HttpContext http) =>
{
    if (!Statuts.Tous.Contains(corps.Statut))
        return Results.BadRequest(new { erreur = $"Statut inconnu : {corps.Statut}" });

    // Renseigné si l'authentification Windows est activée sur le site IIS.
    var utilisateur = http.User.Identity?.IsAuthenticated == true ? http.User.Identity.Name : null;

    var maille = await store.ChangerStatutAsync(id, corps.Statut, utilisateur);
    return maille is null ? Results.NotFound() : Results.Ok(maille);
});

app.Run();
