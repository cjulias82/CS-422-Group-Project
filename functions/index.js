const functions = require("firebase-functions");

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors({origin: true}));


const browserKey = process.env.GOOGLE_BROWSER_KEY;
const serverKey = process.env.GOOGLE_SERVER_KEY;

// ------------------------------
// GET BROWSER GOOGLE MAPS KEY
// ------------------------------
app.get("/google-key", (req, res) => {
  if (!browserKey) {
    console.error("Browser key missing!");
    return res.status(500).json({error: "No browser key configured"});
  }

  res.json({key: browserKey});
});

// ------------------------------
// TRANSIT ROUTES USING SERVER KEY
// ------------------------------
app.get("/routes", async (req, res) => {
  const {from, to} = req.query;

  if (!from || !to) {
    return res.status(400).json({error: "Missing origin or destination"});
  }

  try {
    const response = await axios.get(
        "https://maps.googleapis.com/maps/api/directions/json",
        {
          params: {
            origin: from,
            destination: to,
            mode: "transit",
            region: "us",
            key: serverKey,
          },
        },
    );

    res.json(response.data);
  } catch (err) {
    const errorData =
            err && err.response && err.response.data ?
                err.response.data :
                err;
    console.error("Directions error:", errorData);
    res.status(500).json({error: "Failed to fetch routes"});
  }
});

exports.api = functions.https.onRequest(app);
