// Génère un jeu de données fictif (SIREN valides au sens de la clé de Luhn) pour les tests.
import { writeFileSync } from "node:fs";

const societes = [
  "Atlantique Logistique", "Transports Kerlan", "Rhône Fret Services", "Docks de Gennevilliers",
  "Normandie Transit", "Agence Maritime Sud", "Fret Rail Lorraine", "Entrepôts du Val d'Oise",
  "Comptoir Portuaire de Sète", "Alpes Messagerie", "Garonne Distribution", "Ouest Conteneurs",
];
const mailles = ["IDF-NORD", "IDF-SUD", "HDF-LILLE", "NOR-LEHAVRE", "BRE-RENNES", "PDL-NANTES",
  "NAQ-BORDEAUX", "OCC-SETE", "PACA-FOS", "ARA-LYON", "GE-METZ", "BFC-DIJON"];
const statuts = ["nouveau", "nouveau", "nouveau", "legitime", "legitime", "non_legitime"];

let graine = 42;
const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
const pick = (t) => t[Math.floor(alea() * t.length)];

function siren() {
  const d = Array.from({ length: 8 }, () => Math.floor(alea() * 10));
  if (d[0] === 0) d[0] = 3;
  for (let c = 0; c < 10; c++) {
    const s = [...d, c].reduce((acc, n, i) => {
      let v = i % 2 === 1 ? n * 2 : n;
      return acc + (v > 9 ? v - 9 : v);
    }, 0);
    if (s % 10 === 0) return [...d, c].join("");
  }
}

const data = [];
let n = 1;
for (const societe of societes) {
  const s = siren();
  const nb = 2 + Math.floor(alea() * 3);
  const choisies = new Set();
  while (choisies.size < nb) choisies.add(pick(mailles));
  for (const maille of choisies) {
    data.push({ id: String(n++).padStart(4, "0"), societe, siren: s, maille, statut: pick(statuts) });
  }
}
writeFileSync(process.argv[2], JSON.stringify(data, null, 2) + "\n");
console.log(`${data.length} mailles écrites dans ${process.argv[2]}`);
