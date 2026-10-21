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

    public async Task EnvoyerAsync(string destinataire, string code, DateTimeOffset expiration)
    {
        var s = config.GetSection("Smtp");
        var expediteur = new MailAddress(s["Expediteur"] ?? "suivi-mailles@localhost", s["NomExpediteur"] ?? "Suivi des mailles");
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

        using var client = new SmtpClient();
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
            if (!string.IsNullOrWhiteSpace(s["Utilisateur"]))
                client.Credentials = new NetworkCredential(s["Utilisateur"], s["MotDePasse"]);
        }
        await client.SendMailAsync(message);
        logger.LogInformation("Code d'accès envoyé à {Email}", destinataire);
    }
}
