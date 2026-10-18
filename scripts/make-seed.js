/**
 * Seeds the D1 database with data/patients.json (used for local testing;
 * the deployed preview DB is seeded via /api/seed on first boot).
 */
const fs = require("fs");
const stmts = [];
const patients = JSON.parse(fs.readFileSync(__dirname + "/../data/patients.json", "utf8"));
stmts.push(fs.readFileSync(__dirname + "/../schema.sql", "utf8"));
patients.forEach((p) => {
  const esc = (s) => (s === undefined || s === null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
  stmts.push(
    `INSERT INTO patients (id, name, phone, age, gender, city, first_visit, seed_notes) VALUES (${esc(p.id)}, ${esc(p.name)}, ${esc(p.phone)}, ${p.age ?? "NULL"}, ${esc(p.gender)}, ${esc(p.city)}, ${esc(p.firstVisit)}, ${esc(p.notes)})`
  );
  if (p.notes) {
    stmts.push(
      `INSERT OR IGNORE INTO notes (registration_number, owner, body) VALUES (${esc(p.id)}, '_seed_owner_', ${esc(p.notes)})`
    );
  }
});
fs.writeFileSync(__dirname + "/../seed.sql", stmts.join(";\n") + ";\n");
console.log("seed.sql written:", patients.length, "patients");
