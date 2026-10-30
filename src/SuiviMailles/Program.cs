using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using SuiviMailles;

var builder = WebApplication.CreateBuilder(args);

// Dossier de données (App_Data par défaut) : il contient aussi smtp.json, la configuration de l'envoi des codes.
var dossierDonnees = Path.GetDirectoryName(Path.GetFullPath(
    builder.Configuration["Stockage:Fichier"] ?? "App_Data/mailles.json", builder.Environment.ContentRootPath))!;
Directory.CreateDirectory(dossierDonnees);
builder.Configuration.AddJsonFile(Path.Combine(dossierDonnees, "smtp.json"), optional: true, reloadOnChange: true);

builder.Services.AddSingleton<MailleStore>();
builder.Services.AddSingleton<UtilisateurStore>();
builder.Services.AddSingleton<EnvoiCode>();

// Clés de chiffrement des cookies de session conservées sur disque : un recyclage du pool IIS ne déconnecte personne.
var protection = builder.Services.AddDataProtection().SetApplicationName("SuiviMailles")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dossierDonnees, "cles")));
// DPAPI au niveau machine : le compte du pool IIS n'a pas toujours de profil utilisateur chargé.
if (OperatingSystem.IsWindows()) protection.ProtectKeysWithDpapi(protectToLocalMachine: true);

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "SuiviMailles";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.SlidingExpiration = false;
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});

var app = builder.Build();

app.UseDefaultFiles();
// Le navigateur revalide la page et les scripts à chaque chargement : après une mise à jour du serveur,
// il ne peut pas continuer à utiliser l'ancienne version gardée en cache.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});
// Les réponses de l'API (dont siren.csv) ne sont jamais mises en cache.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.Headers.CacheControl = "no-store";
    await next();
});

app.UseAuthentication();

// Contrôle d'accès de l'API : toute route exige un utilisateur connecté et toujours déclaré (son profil est relu à chaque
// requête, un changement de profil ou une suppression s'applique donc immédiatement), sauf la connexion et la version.
// La gestion des utilisateurs est réservée au profil Admin.
app.Use(async (ctx, next) =>
{
    var chemin = ctx.Request.Path;
    if (!chemin.StartsWithSegments("/api") || chemin.StartsWithSegments("/api/auth") || chemin.StartsWithSegments("/api/version"))
    {
        await next();
        return;
    }
    var utilisateur = ctx.User.Identity?.IsAuthenticated == true
        ? await ctx.RequestServices.GetRequiredService<UtilisateurStore>().TrouverAsync(ctx.User.Identity.Name)
        : null;
    if (utilisateur is null)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    if (chemin.StartsWithSegments("/api/utilisateurs") && utilisateur.Profil != Profils.Admin)
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    // Profil Lecteur : lecture seule (aucune requête de modification acceptée).
    if (utilisateur.Profil == Profils.Lecteur && !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method))
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    await next();
});

var version = typeof(Program).Assembly
    .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
    .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion ?? "dev";
app.MapGet("/api/version", () => Results.Ok(new { version }));

// ---- Connexion par code envoyé par mail ----
var auth = app.MapGroup("/api/auth");

auth.MapGet("/moi", async (HttpContext http, UtilisateurStore utilisateurs) =>
    http.User.Identity?.IsAuthenticated == true && await utilisateurs.TrouverAsync(http.User.Identity.Name) is { } u
        ? Results.Ok(new { u.Email, u.Nom, u.Profil })
        : Results.Unauthorized());

auth.MapPost("/code", async (DemandeCode demande, UtilisateurStore utilisateurs, EnvoiCode envoi) =>
{
    var email = UtilisateurStore.Normaliser(demande.Email);
    if (!UtilisateurStore.EmailValide(email))
        return Results.BadRequest(new { erreur = "Adresse mail invalide." });
    if (!envoi.EstConfigure)
        return Results.Json(new { erreur = "L'envoi des codes n'est pas configuré sur le serveur (fichier smtp.json). Contactez l'administrateur." },
            statusCode: StatusCodes.Status503ServiceUnavailable);

    var (resultat, code, expiration) = await utilisateurs.CreerCodeAsync(email);
    switch (resultat)
    {
        case ResultatDemande.Inconnu:
            return Results.Json(new { erreur = "Cette adresse n'est pas déclarée dans l'application. Contactez un administrateur." },
                statusCode: StatusCodes.Status404NotFound);
        case ResultatDemande.TropRapproche:
            return Results.Json(new { erreur = "Un code vient d'être envoyé. Patientez une minute avant d'en demander un autre." },
                statusCode: StatusCodes.Status429TooManyRequests);
    }
    try
    {
        await envoi.EnvoyerAsync(email, code!, expiration);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Échec de l'envoi du code à {Email}", email);
        // Journal lisible sans activer les logs IIS : App_Data\journal-envoi.log
        File.AppendAllText(Path.Combine(dossierDonnees, "journal-envoi.log"),
            $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {email}  {EnvoiCode.Detail(ex)}{Environment.NewLine}");
        await utilisateurs.AnnulerCodeAsync(email);
        return Results.Json(new { erreur = "Le mail n'a pas pu être envoyé. Réessayez plus tard ou contactez l'administrateur." },
            statusCode: StatusCodes.Status502BadGateway);
    }
    return Results.Ok(new { expiration });
});

auth.MapPost("/connexion", async (DemandeConnexion demande, UtilisateurStore utilisateurs, HttpContext http) =>
{
    var (u, erreur) = await utilisateurs.VerifierAsync(demande.Email, demande.Code);
    if (u is null) return Results.BadRequest(new { erreur });

    // Session valable, comme le code, jusqu'à 23:59:59 le jour même.
    var identite = new ClaimsIdentity([new Claim(ClaimTypes.Name, u.Email)], CookieAuthenticationDefaults.AuthenticationScheme);
    await http.SignInAsync(new ClaimsPrincipal(identite), new AuthenticationProperties
    {
        IsPersistent = true,
        AllowRefresh = false,
        ExpiresUtc = new DateTimeOffset(DateTime.Today.AddDays(1)).ToUniversalTime(),
    });
    return Results.Ok(new { u.Email, u.Nom, u.Profil });
});

auth.MapPost("/deconnexion", async (HttpContext http) =>
{
    await http.SignOutAsync();
    return Results.NoContent();
});

// ---- Gestion des utilisateurs (profil Admin, contrôlé plus haut) ----
var gestion = app.MapGroup("/api/utilisateurs");

gestion.MapGet("/", async (UtilisateurStore utilisateurs) => Results.Ok(await utilisateurs.ListerAsync()));

gestion.MapPost("/", async (UtilisateurSaisi saisie, UtilisateurStore utilisateurs, HttpContext http) =>
{
    var (u, erreur) = await utilisateurs.EnregistrerAsync(saisie, http.User.Identity!.Name!);
    return u is null ? Results.BadRequest(new { erreur }) : Results.Ok(u);
});

// Diagnostic SMTP : envoie un mail de test à l'administrateur connecté et renvoie l'erreur exacte en cas d'échec.
gestion.MapPost("/test-mail", async (EnvoiCode envoi, HttpContext http) =>
{
    var destinataire = http.User.Identity!.Name!;
    if (!envoi.EstConfigure)
        return Results.Ok(new { ok = false, destinataire, parametres = envoi.Parametres(), detail = "Configuration incomplète : Serveur et Expediteur sont obligatoires dans smtp.json." });
    try
    {
        await envoi.EnvoyerTestAsync(destinataire);
        return Results.Ok(new { ok = true, destinataire, parametres = envoi.Parametres(), detail = (string?)null });
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Échec du mail de test");
        return Results.Ok(new { ok = false, destinataire, parametres = envoi.Parametres(), detail = EnvoiCode.Detail(ex) });
    }
});

gestion.MapPost("/supprimer", async (DemandeCode cible, UtilisateurStore utilisateurs, HttpContext http) =>
    await utilisateurs.SupprimerAsync(cible.Email, http.User.Identity!.Name!) is { } erreur
        ? Results.BadRequest(new { erreur })
        : Results.NoContent());

var api = app.MapGroup("/api/mailles");

api.MapGet("/", async (MailleStore store) => Results.Ok(await store.ListerAsync()));

// POST plutôt que PUT/DELETE : WebDAV, souvent installé sur les serveurs IIS, intercepte PUT et DELETE.
api.MapPost("/{id}/statut", async (string id, ChangementStatut corps, MailleStore store, HttpContext http) =>
{
    if (!Statuts.Tous.Contains(corps.Statut))
        return Results.BadRequest(new { erreur = $"Statut inconnu : {corps.Statut}" });

    // Adresse mail de l'utilisateur connecté.
    var utilisateur = http.User.Identity?.Name;

    var maille = await store.ChangerStatutAsync(id, corps.Statut, utilisateur);
    return maille is null ? Results.NotFound() : Results.Ok(maille);
});

api.MapPost("/{id}/supprimer", async (string id, MailleStore store, HttpContext http) =>
{
    var utilisateur = http.User.Identity?.Name;
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

    var utilisateur = http.User.Identity?.Name;
    return Results.Ok(await store.ImporterAsync(demande.Lignes, utilisateur));
});

var societes = app.MapGroup("/api/societes");

societes.MapGet("/", async (MailleStore store) => Results.Ok(await store.ListerSocietesAsync()));

// Création ou renommage d'une société (nom vide : efface le nom).
societes.MapPost("/", async (Societe corps, MailleStore store) =>
    await store.DefinirSocieteAsync(corps.Siren, corps.Nom) is { } vue
        ? Results.Ok(vue)
        : Results.BadRequest(new { erreur = $"SIREN invalide : {corps.Siren}" }));

societes.MapPost("/import", async (DemandeImportSocietes demande, MailleStore store) =>
{
    if (demande.Lignes is null || demande.Lignes.Count == 0)
        return Results.BadRequest(new { erreur = "Aucune ligne à importer." });
    return Results.Ok(await store.ImporterSocietesAsync(demande.Lignes));
});

app.Run();
