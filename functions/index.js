const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors({origin: true}));

const GOOGLE_BROWSER_KEY = process.env.GOOGLE_BROWSER_KEY;
const GOOGLE_SERVER_KEY = process.env.GOOGLE_SERVER_KEY;
const CTA_BUS_KEY = process.env.CTA_BUS_KEY;
const CTA_TRAIN_KEY = process.env.CTA_TRAIN_KEY;

console.log("Loaded environment keys:", {
  browser: GOOGLE_BROWSER_KEY ? "OK" : "MISSING",
  server: GOOGLE_SERVER_KEY ? "OK" : "MISSING",
  bus: CTA_BUS_KEY ? "OK" : "MISSING",
  train: CTA_TRAIN_KEY ? "OK" : "MISSING",
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

// Tracks nearby page
app.get("/tracknearby", async (req, res) => {
  const {lat, lng} = req.query;
  if (!lat || !lng) return res.status(400).json({error: "Missing lat/lng"});

  try {
    // 1. Google Places — Nearby Transit Stations
    const placesRes = await axios.get(
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
        {
          params: {
            location: `${lat},${lng}`,
            radius: 1200,
            keyword: "bus stop OR train station OR subway station",
            key: GOOGLE_SERVER_KEY, // MUST use server key
          },
        },
    );

    const stations =
            (placesRes.data.results || []).map((place) => ({
              name: place.name,
              location: place.geometry.location,
              address: place.vicinity,
            })) || [];

    // 2. CTA Bus Tracker (system-wide)
    const busRes = await axios.get(
        "https://www.ctabustracker.com/bustime/api/v3/getvehicles",
        {
          params: {
            key: CTA_BUS_KEY,
            rt: "all", // FIX: required parameter
            format: "json",
          },
        },
    );

    const busData = busRes.data["bustime-response"];
    const vehicles = busData && busData.vehicle ? busData.vehicle : [];

    const buses = vehicles.map((v) => ({
      id: v.vid,
      route: v.rt,
      lat: parseFloat(v.lat),
      lng: parseFloat(v.lon),
      destination: v.des,
    }));


    // 3. CTA Train Tracker (system-wide)
    const trainRes = await axios.get(
        "https://lapi.transitchicago.com/api/1.0/ttpositions.aspx",
        {
          params: {
            key: CTA_TRAIN_KEY,
            rt: "all", // FIX: required parameter
            outputType: "JSON",
          },
        },
    );

    // eslint-disable-next-line max-len
    const trainRoot = trainRes.data && trainRes.data.ctatt ? trainRes.data.ctatt : {};
    const trainsData = trainRoot.route ? trainRoot.route : [];

    const trains = trainsData.flatMap((route) => {
      const trainList = route.train ? route.train : [];

      return trainList.map((t) => ({
        id: t.rn,
        route: route.rt,
        lat: parseFloat(t.lat),
        lng: parseFloat(t.lon),
        destination: t.destNm,
      }));
    });

    // Optional distance filtering (1.5 km radius)
    // eslint-disable-next-line no-inner-declarations,require-jsdoc
    function distance(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * (Math.PI / 180)) *
                Math.cos(lat2 * (Math.PI / 180)) *
                Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const nearbyBuses = buses.filter(
        (b) => distance(lat, lng, b.lat, b.lng) <= 1.5,
    );

    const nearbyTrains = trains.filter(
        (t) => distance(lat, lng, t.lat, t.lng) <= 1.5,
    );

    return res.json({
      stations,
      buses: nearbyBuses,
      trains: nearbyTrains,
      counts: {
        stations: stations.length,
        buses: nearbyBuses.length,
        trains: nearbyTrains.length,
      },
    });
  } catch (error) {
    console.error("TRACKNEARBY error:", error.message);
    return res.status(500).json({error: "Failed to fetch nearby transit data"});
  }
});

// --------------------------------------------------------------
// EXPORT FUNCTION
// --------------------------------------------------------------
exports.api = functions.https.onRequest(app);
