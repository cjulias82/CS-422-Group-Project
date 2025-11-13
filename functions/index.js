/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {setGlobalOptions} = require("firebase-functions");
// const {onRequest} = require("firebase-functions/https");
// const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// Allow any front-end domain (Firebase Hosting)
app.use(cors({origin: true}));

// -------------------------
// Google Maps Browser Key
// -------------------------
app.get("/google-key", (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY_BROWSER;
  if (!key) return res.status(500).json({error: "No browser key configured"});
  res.json({key});
});

// -------------------------
// Google Directions API (server key)
// -------------------------
app.get("/routes", async (req, res) => {
  const {from, to} = req.query;

  if (!from || !to) {
    return res.status(400).json({error: "Missing origin or destination"});
  }

  try {
    const result = await axios.get(
        "https://maps.googleapis.com/maps/api/directions/json",
        {
          params: {
            origin: from,
            destination: to,
            mode: "transit",
            key: process.env.GOOGLE_MAPS_API_KEY_SERVER, // <-- SERVER key
          },
        },
    );

    res.json(result.data);
  } catch (err) {
    // Firebase-safe error handler
    const errorData =
            err.response && err.response.data ?
                err.response.data :
                err;

    console.error("Directions error:", errorData);
    res.status(500).json({error: "Failed to fetch routes"});
  }
});

// -------------------------
// Export function endpoint
// -------------------------
exports.api = functions.https.onRequest(app);
