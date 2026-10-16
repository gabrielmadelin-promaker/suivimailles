// Assemble l'interface (index.html + app.css + app.js) et le jeu de données fictif en une page autonome
// qui fonctionne sans serveur : c'est l'artefact de test.
import { readFileSync, writeFileSync } from "node:fs";

const [sortie = "artefact/suivi-mailles.html"] = process.argv.slice(2);
const www = new URL("../src/SuiviMailles/wwwroot/", import.meta.url);
const lire = f => readFileSync(new URL(f, www), "utf8");

const html = lire("index.html");
const corps = html.split("<!-- CORPS:DEBUT -->")[1].split("<!-- CORPS:FIN -->")[0];
const fontes = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const donnees = readFileSync(new URL("../src/SuiviMailles/Data/mailles.seed.json", import.meta.url), "utf8");

const page = `<title>Suivi des mailles</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fontes}
<style>
${lire("app.css")}
</style>
${corps.trim()}
<script>window.SUIVI_DEMO_DATA = ${donnees.trim()};</script>
<script>
${lire("app.js")}
</script>
`;
writeFileSync(sortie, page);
console.log(`Artefact écrit : ${sortie}`);
