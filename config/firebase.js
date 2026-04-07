const admin = require("firebase-admin");
const path = require("path");

// Aponta para o arquivo JSON na raiz do projeto
const serviceAccount = require(path.join(__dirname, "../firebase-key.json"));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

module.exports = { admin, db };