const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors({origin: true}));

const GOOGLE_BROWSER_KEY = process.env.GOOGLE_BROWSER_KEY;
const GOOGLE_SERVER_KEY = process.env.GOOGLE_SERVER_KEY;

console.log("Loaded environment keys:", {
  // eslint-disable-next-line max-len
  browser: GOOGLE_BROWSER_KEY ? "OK" : "MISSING", server: GOOGLE_SERVER_KEY ? "OK" : "MISSING",
});

// --------------------------------------------------------------
// GET BROWSER-SAFE GOOGLE MAPS KEY
// --------------------------------------------------------------
app.get("/google-key", (req, res) => {
  if (!GOOGLE_BROWSER_KEY) {
    console.error("Browser key missing!");
    return res.status(500).json({error: "Browser key not configured"});
  }
  res.json({key: GOOGLE_BROWSER_KEY});
});

// --------------------------------------------------------------
// TRANSIT ROUTES (Google Directions API)
// --------------------------------------------------------------
app.get("/routes", async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;

  if (!from || !to) {
    return res.status(400).json({error: "Missing origin or destination"});
  }

  try {
    const url = "https://maps.googleapis.com/maps/api/directions/json";

    const response = await axios.get(url, {
      params: {
        // eslint-disable-next-line max-len
        origin: from, destination: to, mode: "transit", alternatives: true, key: GOOGLE_SERVER_KEY,
      },
    });

    const data = response.data;

    if (data.status !== "OK") {
      // eslint-disable-next-line max-len
      console.error("Google Directions API error:", data.status, data.error_message);
      return res.status(500).json({
        error: data.error_message ? data.error_message : data.status,
      });
    }

    const routes = data.routes.map((route) => {
      const leg = route.legs && route.legs.length > 0 ? route.legs[0] : null;

      if (!leg) {
        return {
          duration: "", distance: "", arrival: "", departure: "", steps: [],
        };
      }

      const steps = leg.steps.map((s) => {
        const mode = s.travel_mode ? s.travel_mode.toUpperCase() : "OTHER";

        // WALKING
        if (mode === "WALKING") {
          return {
            type: "walking",
            instructions: s.html_instructions ? s.html_instructions : "Walk",
            distance: s.distance ? s.distance.text : "",
            duration: s.duration ? s.duration.text : "",
          };
        }

        // TRANSIT: bus or train
        if (mode === "TRANSIT") {
          const t = s.transit_details ? s.transit_details : null;

          if (!t || !t.line) {
            return {
              type: "other",
              instructions: s.html_instructions ? s.html_instructions : "",
              distance: s.distance ? s.distance.text : "",
              duration: s.duration ? s.duration.text : "",
            };
          }

          const vehicle = t.line.vehicle ? t.line.vehicle.type : "";
          const vehicleUpper = vehicle ? vehicle.toUpperCase() : "";
          // eslint-disable-next-line max-len
          const isTrain = vehicleUpper === "SUBWAY" || vehicleUpper === "HEAVY_RAIL" || vehicleUpper === "TRAM" || vehicleUpper === "RAIL";

          return {
            type: isTrain ? "train" : "bus",
            // eslint-disable-next-line max-len
            routeName: t.line.short_name ? t.line.short_name : t.line.name ? t.line.name : "",
            headsign: t.headsign ? t.headsign : "",
            departureStop: t.departure_stop ? t.departure_stop.name : "",
            arrivalStop: t.arrival_stop ? t.arrival_stop.name : "",
            numStops: t.num_stops ? t.num_stops : 0,
            departureTime: t.departure_time ? t.departure_time.text : "",
            arrivalTime: t.arrival_time ? t.arrival_time.text : "",
            distance: s.distance ? s.distance.text : "",
            duration: s.duration ? s.duration.text : "",
            instructions: s.html_instructions ? s.html_instructions : "",
            color: t.line.color ? t.line.color : isTrain ? "#1565C0" : "#555",
            // eslint-disable-next-line max-len
            agency: t.line.agencies && t.line.agencies.length > 0 && t.line.agencies[0].name ? t.line.agencies[0].name : "CTA",
          };
        }

        // FALLBACK
        return {
          type: "other",
          instructions: s.html_instructions ? s.html_instructions : "Continue",
          distance: s.distance ? s.distance.text : "",
          duration: s.duration ? s.duration.text : "",
        };
      });

      return {
        duration: leg.duration ? leg.duration.text : "",
        distance: leg.distance ? leg.distance.text : "",
        arrival: leg.arrival_time ? leg.arrival_time.text : "",
        departure: leg.departure_time ? leg.departure_time.text : "",
        startAddress: leg.start_address,
        endAddress: leg.end_address,
        steps,
      };
    });

    res.json({routes});
  } catch (err) {
    console.error("Error fetching routes:", err.message);
    res.status(500).json({error: "Failed to fetch transit routes"});
  }
});

// --------------------------------------------------------------
// EXPORT FUNCTION
// --------------------------------------------------------------
exports.api = functions.https.onRequest(app);
