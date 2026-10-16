// Construit le jeu de données initial à partir d'un export adresses_de_facturation.csv
// (colonne 1 = SIREN, colonne 4 = maille). Toutes les mailles partent au statut « Nouveau ».
// Usage : node tools/seed-depuis-csv.mjs <adresses_de_facturation.csv> <mailles.seed.json>
import { readFileSync, writeFileSync } from "node:fs";

const [entree, sortie] = process.argv.slice(2);
const texte = readFileSync(entree, "utf8").replace(/^﻿/, "");
const sep = texte.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
const vues = new Set();
const data = [];
texte.split(/\r?\n/).forEach((ligne, i) => {
  const cols = ligne.split(sep);
  let siren = (cols[0] ?? "").replace(/\s/g, "");
  const maille = (cols[3] ?? "").trim();
  if (i === 0 && !/[0-9]/.test(siren)) return;
  if (/^[0-9]{1,8}$/.test(siren)) siren = siren.padStart(9, "0");
  if (!/^[0-9]{9}$/.test(siren) || !maille) return;
  const cle = `${siren}|${maille.toLowerCase()}`;
  if (vues.has(cle)) return;
  vues.add(cle);
  data.push({ id: String(data.length + 1).padStart(4, "0"), societe: "", siren, maille, statut: "nouveau" });
});
writeFileSync(sortie, JSON.stringify(data, null, 2) + "\n");
console.log(`${data.length} mailles écrites dans ${sortie}`);
