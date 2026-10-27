// Organizations and rank tables, from the Official Ranking Structure sheet.
// Bands: head → tier 3, general → tier 3, officer → tier 2, nco → tier 1, enlisted → tier 1.

export const COMPARTMENTS = ["public", "secret", "government"];

export const ORGS = [
  { slug: "vsk",        name: "VSK",                          long: "Volkssicherheitskräfte · 1st VSK Division “Bahr”",                 compartment: "secret",     min_tier: 1, sort: 1 },
  { slug: "nypd",       name: "NYPD",                         long: "New York Police Department",                                      compartment: "public",     min_tier: 1, sort: 2 },
  { slug: "abi",        name: "ABI",                          long: "American Bureau of Investigation",                                compartment: "secret",     min_tier: 1, sort: 3 },
  { slug: "mp1",        name: "1st Military Police",          long: "1st Military Police Battalion · New York Military Police",        compartment: "secret",     min_tier: 1, sort: 4 },
  { slug: "div11",      name: "11th Military Division",       long: "11th Division · National Guard of the Capital",                   compartment: "secret",     min_tier: 1, sort: 5 },
  { slug: "air91",      name: "91st Air Division",            long: "91st Air Division “Himmelwolf” · Honor Guard of the Lord Protector", compartment: "secret",   min_tier: 1, sort: 6 },
  { slug: "nsb",        name: "NSB",                          long: "National Security Bureau · Regional Office of the Capital",       compartment: "secret",     min_tier: 1, sort: 7 },
  { slug: "civilian",   name: "Civilian",                     long: "Civilians of the Capital",                                        compartment: "public",     min_tier: 1, sort: 8 },
  { slug: "government", name: "Government",                   long: "Office of the Governor · Council of New York · Civil Service",   compartment: "government", min_tier: 1, sort: 9 },
  { slug: "party",      name: "Party",                        long: "Imperial Ruling Party · North American Advocacy",                 compartment: "government", min_tier: 4, sort: 10 },
];

// Earlier long names, so an already-seeded database picks up the corrections
// without touching any name an admin has edited by hand.
export const OLD_LONG_NAMES = {
  vsk: "Sicherheitskorps · VSK",
  mp1: "1st Military Police Battalion",
  div11: "11th Division, National Guard",
  air91: "91st Air Division, National Guard",
  nsb: "Sicherheitskorps · NSB",
  government: "Office of the Governor · Civil Service",
};

const B = { head: 3, general: 3, officer: 2, nco: 1, enlisted: 1 };
export const BAND_TIER = B;

// [org, band, names in order from highest to lowest]
const R = [
  ["div11", "general",  ["Oberbefehlshaber von Nordamerika / Feldmarschall", "Generaloberst", "General der Infanterie", "Generalleutnant", "Generalmajor"]],
  ["div11", "officer",  ["Oberst", "Oberstleutnant", "Major", "Hauptmann", "Oberleutnant", "Leutnant"]],
  ["div11", "nco",      ["Stabsfeldwebel", "Hauptfeldwebel", "Oberfeldwebel", "Feldwebel", "Unterfeldwebel", "Unteroffizier"]],
  ["div11", "enlisted", ["Stabsgefreiter", "Gefreiter", "Obergrenadier", "Grenadier"]],

  ["mp1", "general",  ["Generaloberst", "General der Militärpolizei", "Generalleutnant", "Generalmajor"]],
  ["mp1", "officer",  ["Militärdirektor", "Militäroberinspektor", "Militärinspektor", "Militärkommissar", "Militärobersekretar", "Militärsekretar"]],
  ["mp1", "nco",      ["Militärassistent", "Militärfeldwebel", "Militärhauptmeister", "Militärobermeister", "Militärmeister", "Militäruntermeister"]],

  ["air91", "general",  ["Generaloberst", "General der Luftwaffe", "Generalleutnant", "Generalmajor"]],
  ["air91", "officer",  ["Oberst", "Oberstleutnant", "Major", "Hauptmann", "Oberleutnant", "Leutnant"]],
  ["air91", "nco",      ["Stabsfeldwebel", "Hauptfeldwebel", "Oberfeldwebel", "Feldwebel", "Unterfeldwebel", "Unteroffizier"]],
  ["air91", "enlisted", ["Stabsgefreiter", "Gefreiter", "Obergrenadier", "Grenadier"]],

  ["nsb", "general",  ["Generalkommissar von Nordamerika", "Oberst-Sicherheitsleiter", "Obersicherheitsleiter", "Sicherheitsleiter", "Korpsleiter"]],
  ["nsb", "officer",  ["Sicherheitskommandeur", "Hauptdienstoffizier", "Oberdienstoffizier", "Dienstoffizier", "Hauptkommissar", "Oberkommissar", "Kommissar"]],
  ["nsb", "nco",      ["Kommissaranwärter", "Hauptmeister", "Obermeister", "Meister", "Untermeister"]],

  ["vsk", "general",  ["Generaloberst", "General der Sicherheitskrafte", "Generalleutnant", "Generalmajor"]],
  ["vsk", "officer",  ["Kommandeur", "Oberst", "Oberstleutnant", "Major", "Hauptmann", "Oberleutnant", "Leutnant"]],
  ["vsk", "nco",      ["Stabsfeldwebel", "Hauptfeldwebel", "Oberfeldwebel", "Feldwebel", "Unterfeldwebel", "Unteroffizier"]],
  ["vsk", "enlisted", ["Obergefreiter", "Gefreiter", "Obergrenadier", "Grenadier"]],

  ["abi", "general",  ["Director"]],
  ["abi", "officer",  ["Deputy Director", "Chief Inspector", "Senior Inspector", "Inspector", "Special Agent", "Senior Agent", "Agent"]],
  ["abi", "nco",      ["Chief Operative", "Senior Operative", "Operative", "Senior Detective", "Detective"]],

  ["nypd", "general",  ["Commissioner", "Chief"]],
  ["nypd", "officer",  ["Commander", "Colonel", "Lieutenant Colonel", "Major", "Captain", "First Lieutenant", "Second Lieutenant"]],
  ["nypd", "nco",      ["Sergeant Major", "Master Sergeant", "First Sergeant", "Staff Sergeant", "Sergeant"]],
  ["nypd", "enlisted", ["Corporal", "Senior Officer", "Officer", "Cadet"]],

  ["government", "head",     ["Lord Protector", "Governor of New York", "Mayor of New York City"]],
  ["government", "general",  ["Chief Justice", "Comptroller", "Commissioner of Logistics", "District Attorney", "Councilor", "Undersecretary"]],
  ["government", "officer",  ["Deputy Mayor", "Deputy District Attorney", "Chief Supervisor", "Senior Supervisor", "Supervisor", "Chief Advisor", "Senior Advisor", "Advisor"]],
  ["government", "nco",      ["Chief Associate", "Senior Associate", "Associate", "Senior Clerk", "Clerk"]],
  ["government", "enlisted", ["Senior Assistant", "Assistant", "Apprentice", "Intern"]],

  ["party", "general",  ["Kaiserlicherleiter", "Parteiverwaltungsleiter", "Parteihauptratsleiter", "Parteioberratsleiter", "Parteiratsleiter"]],
  ["party", "officer",  ["Hauptlandesleiter", "Oberlandesleiter", "Landesleiter", "Hauptamtsleiter", "Oberamtsleiter", "Amtsleiter"]],
  ["party", "nco",      ["Amtsrat", "Amtsmann", "Hauptinspektor", "Oberinspektor", "Inspektor"]],
  ["party", "enlisted", ["Hauptparteigehilfe", "Oberparteigehilfe", "Parteigehilfe", "Anwärter"]],

  ["civilian", "enlisted", ["Civilian"]],
];

export const RANKS = [];
for (const [org, band, names] of R) {
  let i = RANKS.filter((r) => r.org === org).length;
  for (const name of names) RANKS.push({ org, band, name, tier: B[band], sort: i++ });
}
