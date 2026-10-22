using System.Net;
using System.Net.Mail;
using System.Text;

namespace SuiviMailles;

/// <summary>Envoi du code d'accès par mail, avec le serveur SMTP décrit dans smtp.json (section Smtp).</summary>
public sealed class EnvoiCode(IConfiguration config, ILogger<EnvoiCode> logger)
{
    public bool EstConfigure =>
        !string.IsNullOrWhiteSpace(config["Smtp:DossierTest"]) ||
        (!string.IsNullOrWhiteSpace(config["Smtp:Serveur"]) && !string.IsNullOrWhiteSpace(config["Smtp:Expediteur"]));

    /// <summary>Paramètres effectivement utilisés (sans le mot de passe), pour le diagnostic.</summary>
    public object Parametres()
    {
        var s = config.GetSection("Smtp");
        return new
        {
            mode = string.IsNullOrWhiteSpace(s["DossierTest"]) ? "envoi SMTP" : $"dossier de test ({s["DossierTest"]}) : aucun mail n'est envoyé",
            serveur = s["Serveur"], port = s["Port"], ssl = s["Ssl"],
            authentification = string.IsNullOrWhiteSpace(s["Utilisateur"]) ? "aucune" : $"{s["Utilisateur"]} (mot de passe {(string.IsNullOrEmpty(s["MotDePasse"]) ? "VIDE" : "renseigné")})",
            expediteur = s["Expediteur"],
        };
    }

    /// <summary>Message d'erreur complet (avec les erreurs internes et le code SMTP), pour le diagnostic.</summary>
    public static string Detail(Exception ex)
    {
        var parties = new List<string>();
        for (var e = ex; e is not null; e = e.InnerException)
            parties.Add(e is SmtpException smtp ? $"{e.Message} (code SMTP {(int)smtp.StatusCode} {smtp.StatusCode})" : e.Message);
        return string.Join(" → ", parties.Distinct());
    }

    /// <summary>Mail de test envoyé à l'administrateur qui le demande.</summary>
    public async Task EnvoyerTestAsync(string destinataire)
    {
        using var message = new MailMessage(Expediteur(), new MailAddress(destinataire))
        {
            Subject = "Test d'envoi - Suivi des mailles", SubjectEncoding = Encoding.UTF8, BodyEncoding = Encoding.UTF8,
            Body = $"Ce mail de test confirme que l'application Suivi des mailles peut envoyer les codes d'accès.\r\nEnvoyé le {DateTime.Now:dd/MM/yyyy HH:mm:ss}.",
        };
        using var client = Client();
        await client.SendMailAsync(message);
    }

    private MailAddress Expediteur()
    {
        var s = config.GetSection("Smtp");
        return new MailAddress(s["Expediteur"] ?? "suivi-mailles@localhost", s["NomExpediteur"] ?? "Suivi des mailles");
    }

    private SmtpClient Client()
    {
        var s = config.GetSection("Smtp");
        var client = new SmtpClient { Timeout = 30000 };
        var dossierTest = s["DossierTest"];
        if (!string.IsNullOrWhiteSpace(dossierTest))
        {
            // Mode test : le mail est déposé en fichier .eml au lieu d'être envoyé.
            Directory.CreateDirectory(dossierTest);
            client.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
            client.PickupDirectoryLocation = Path.GetFullPath(dossierTest);
        }
        else
        {
            client.Host = s["Serveur"]!;
            client.Port = int.TryParse(s["Port"], out var port) ? port : 25;
            client.EnableSsl = bool.TryParse(s["Ssl"], out var ssl) && ssl;
            client.DeliveryMethod = SmtpDeliveryMethod.Network;
            if (!string.IsNullOrWhiteSpace(s["Utilisateur"]))
            {
                client.UseDefaultCredentials = false;
                client.Credentials = new NetworkCredential(s["Utilisateur"], s["MotDePasse"]);
            }
        }
        return client;
    }

    public async Task EnvoyerAsync(string destinataire, string code, DateTimeOffset expiration)
    {
        var expediteur = Expediteur();
        var fin = expiration.ToString("dddd d MMMM yyyy 'à' HH'h'mm", new System.Globalization.CultureInfo("fr-FR"));

        using var message = new MailMessage(expediteur, new MailAddress(destinataire))
        {
            Subject = "Votre code d'accès - Suivi des mailles",
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = true,
            Body = $"""
                <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b2230">
                  <p>Bonjour,</p>
                  <p>Voici votre code d'accès à l'application <b>Suivi des mailles</b> :</p>
                  <p style="font-family:Consolas,monospace;font-size:24px;letter-spacing:3px;background:#f2f4f7;padding:12px 16px;display:inline-block;border-radius:6px">{WebUtility.HtmlEncode(code)}</p>
                  <p>Il est valable jusqu'au {WebUtility.HtmlEncode(fin)}. Respectez les majuscules et minuscules.</p>
                  <p style="color:#5d6779">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
                </div>
                """,
        };
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(
            $"Votre code d'accès à Suivi des mailles : {code}\r\nValable jusqu'au {fin}.\r\n", Encoding.UTF8, "text/plain"));

        using var client = Client();
        await client.SendMailAsync(message);
        logger.LogInformation("Code d'accès envoyé à {Email}", destinataire);
    }
}
